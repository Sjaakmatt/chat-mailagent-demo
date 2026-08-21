import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  runRoute,
  type Classification,
  type Signal,
  type TaskDescriptor,
} from '@factumai/agent-core';
import type { Env, PlatformStore, RouterParams } from '../env.js';
import { createPlatformStore } from '../store.js';
import { buildOrchestrationSteps, buildLlmClient, hydrateSignal } from '../steps.js';
import { resolveModule } from '../modules.js';

/**
 * Onder deze router-confidence loggen we naar aios_unknown_intent_log voor
 * latere clustering. Bewust ruim (0.5) — beter iets te veel loggen dan
 * blind gaan op wat de router twijfelend classificeerde.
 */
const UNKNOWN_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Router-Workflow (Fase 2/3 — multi-agent split).
 *
 * Verantwoordelijkheid: **alleen classify + dispatch**. Zodra de router weet
 * welke specialist(en) deze mail hoort/horen te behandelen, spawnt hij per
 * taak een `SpecialistWorkflow` en (bij compound) een `AggregatorWorkflow`.
 *
 * Twee dispatch-paden:
 * - **Single** — `classification.compound` false / tasks ontbrekend: één
 *   specialist met `mode='single'`, taskId='primary'. Specialist schrijft
 *   direct een ReviewItem. Geen aggregator nodig.
 * - **Compound** — `classification.compound=true` en `tasks.length ≥ 2`:
 *   fan-out naar N specialisten met `mode='compound'` en per-task taskId.
 *   Aggregator dispatcht met `expectedTasks=N` — die wacht tot alle
 *   partials in `aios_partial_responses` staan en produceert één
 *   compound ReviewItem.
 *
 * Idempotency-keys op elke instance:
 *   RouterWorkflow      route-{msgId}
 *   SpecialistWorkflow  spec-{signalId}-{taskId}
 *   AggregatorWorkflow  aggr-{signalId}
 */
export class RouterWorkflow extends WorkflowEntrypoint<Env, RouterParams> {
  async run(event: WorkflowEvent<RouterParams>, step: WorkflowStep): Promise<void> {
    const store = createPlatformStore(this.env);
    const llm = buildLlmClient(this.env);
    const { signalId } = event.payload;

    await step.do('route-and-dispatch', async () => {
      const raw = await store.loadSignal(signalId);
      const signal = await hydrateSignal(this.env, raw);

      // Wie behandelt dit? Geen match is een expliciete uitkomst en geen
      // terugval: een signaal door de poort van een willekeurig ander proces
      // sturen levert een net geformuleerd "daar ga ik niet over" op iets waar
      // wél iemand naar had moeten kijken. Het signaal blijft staan.
      const pack = resolveModule(signal);
      if (!pack) {
        console.warn(
          `[router] geen module claimt ${signalId} (${signal.domain}/${signal.type}) — ` +
            `niet gerouteerd`,
        );
        return;
      }

      const classification = await runRoute(signal, {
        pack,
        steps: buildOrchestrationSteps(this.env, llm, pack),
      });

      // Auto-discovery: best-effort logging bij twijfel of escalate-fallback.
      // Faalt de write, dan gaat de dispatch onverstoord door — deze log is
      // observability, geen kritiek pad.
      await logIfUnknown(store, signalId, signal, classification);

      const tasks = compoundTasks(classification);
      if (tasks) {
        await dispatchCompound(this.env, signalId, classification, tasks);
      } else {
        await dispatchSingle(this.env, signalId, classification);
      }
    });
  }
}

/**
 * Schrijft een `aios_unknown_intent_log`-rij als de router onder de
 * confidence-drempel bleef of naar `escalate` viel. Idempotent op signalId
 * (id = `unk_{signalId}`), zodat een router-retry geen duplicaten oplevert.
 * Best-effort: exceptions worden gelogd maar niet doorgegooid.
 */
async function logIfUnknown(
  store: PlatformStore,
  signalId: string,
  signal: Signal,
  cls: Classification,
): Promise<void> {
  // Bij compound heeft de router juist WEL geclassificeerd (decompose naar
  // tasks). De parent-classification krijgt category='overig' + specialist=
  // 'escalate' als mapping-artefact — dat mogen we niet als "onbekende
  // intent" loggen. De echte specialist-keuze zit in de per-task
  // sub-classifications, en die worden apart getriaged.
  if (cls.compound === true) return;

  const belowThreshold = cls.confidence < UNKNOWN_CONFIDENCE_THRESHOLD;
  const escalated = cls.specialist === 'escalate' || cls.escalate === true;
  if (!belowThreshold && !escalated) return;

  const payload = signal.payload as {
    subject?: string;
    bodyText?: string;
    from?: string;
  };
  const subject = (payload.subject ?? '').trim();
  const preview = (payload.bodyText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const from = payload.from ?? '';

  const reasonBits: string[] = [];
  if (belowThreshold) {
    reasonBits.push(`confidence ${cls.confidence.toFixed(2)} < ${UNKNOWN_CONFIDENCE_THRESHOLD}`);
  }
  if (escalated) {
    reasonBits.push(`escalate=true (specialist=${cls.specialist ?? 'onbekend'}, category=${cls.category})`);
  }

  try {
    await store.saveUnknownIntent({
      id: `unk_${signalId}`,
      signalId,
      routerReasoning: reasonBits.join('; '),
      routerTopCandidates: [
        { specialist: cls.specialist ?? 'escalate', score: cls.confidence },
      ],
      mailSummary:
        `[${from}] ${subject}${preview ? ' — ' + preview : ''}`.slice(0, 500),
    });
  } catch (err) {
    console.warn(
      `[router] saveUnknownIntent faalde signal=${signalId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Fan-out-check: geeft de tasks-lijst terug als de classificatie echt
 * compound is (compound=true én tasks.length ≥ 2), anders null.
 */
function compoundTasks(cls: Classification): TaskDescriptor[] | null {
  if (cls.compound !== true) return null;
  const tasks = cls.tasks ?? [];
  return tasks.length >= 2 ? tasks : null;
}

/** Single-intent: één specialist met `mode='single'` → ReviewItem direct. */
async function dispatchSingle(
  env: Env,
  signalId: string,
  classification: Classification,
): Promise<void> {
  const taskId = 'primary';
  await env.SPECIALIST.create({
    id: `spec-${signalId}-${taskId}`,
    params: { signalId, classification, taskId, mode: 'single' },
  });
}

/**
 * Compound: één specialist per task (`mode='compound'` → PartialResponse) plus
 * één Aggregator die op alle partials wacht en één compound ReviewItem
 * produceert. Per-task classificatie: neemt intent + hints uit de task-
 * descriptor over zodat de specialist z'n scope direct kent.
 */
async function dispatchCompound(
  env: Env,
  signalId: string,
  parent: Classification,
  tasks: TaskDescriptor[],
): Promise<void> {
  for (const task of tasks) {
    // Task-specifieke ordernummer: parent-extracted heeft vaak de samengevoegde
    // string ("SO-100, SO-42, SO-38"); Haiku zet per task het juiste order
    // in refs.order_hint. Overschrijf zodat de plan-stap z'n lookup op HET
    // JUISTE order doet — anders faalt de tool-call en heeft de specialist
    // geen data om mee te werken.
    const taskOrderHint = task.refs.order_hint;
    const extracted: Record<string, unknown> = {
      ...parent.extracted,
      ...task.refs,
      taskSubject: task.subject,
      ...(task.briefing ? { taskBriefing: task.briefing } : {}),
    };
    if (taskOrderHint) {
      extracted.orderNumber = taskOrderHint;
    }

    const taskClassification: Classification = {
      // Categorie leidend voor policy-rules blijft van de parent — de
      // specialist gebruikt intent voor tool-scope en prompt-selectie.
      category: parent.category,
      confidence: parent.confidence,
      needsRag: parent.needsRag,
      escalate: parent.escalate,
      extracted,
      specialist: task.intent,
    };
    await env.SPECIALIST.create({
      id: `spec-${signalId}-${task.id}`,
      params: {
        signalId,
        classification: taskClassification,
        taskId: task.id,
        mode: 'compound',
      },
    });
  }

  await env.AGGREGATOR.create({
    id: `aggr-${signalId}`,
    params: { signalId, expectedTasks: tasks.length },
  });
}
