import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  getIntentConfig,
  runSpecialize,
  type Classification,
  type OrchestrationResult,
  type PartialResponse,
  type SpecialistId,
} from '@factumai/agent-core';
import type { Env, SpecialistParams } from '../env.js';
import { createPlatformStore } from '../store.js';
import { buildOrchestrationSteps, buildLlmClient, hydrateSignal } from '../steps.js';

/**
 * Specialist-Workflow (Fase 2/3 — multi-agent split).
 *
 * Verantwoordelijkheid: het "specialist"-gedeelte van de orchestratie —
 * resolve → retrieve → plan → ground. De keuze van intent (en dus
 * system-prompt / tool-scope / model-tier) komt uit de `Classification`-
 * payload die de RouterWorkflow doorgeeft.
 *
 * Één generieke workflow-klasse dient alle specialisten — de intent-config
 * wordt runtime opgezocht via `getIntentConfig(classification.specialist)`
 * in de plan-stap (`steps.plan` in `steps.ts`).
 *
 * Twee modi (bepaald door `params.mode`, default 'single' voor
 * backwards-compat):
 * - **single**   — het orchestratie-resultaat wordt direct als ReviewItem
 *   in `aios_review_items` geschreven (Fase 2 gedrag).
 * - **compound** — het resultaat wordt vertaald naar een PartialResponse in
 *   `aios_partial_responses`; de AggregatorWorkflow weeft die later tot één
 *   compound ReviewItem.
 */
export class SpecialistWorkflow extends WorkflowEntrypoint<Env, SpecialistParams> {
  async run(event: WorkflowEvent<SpecialistParams>, step: WorkflowStep): Promise<void> {
    const store = createPlatformStore(this.env);
    const llm = buildLlmClient(this.env);
    const { signalId, classification, mode = 'single', taskId = 'primary' } = event.payload;

    await step.do('specialize', async () => {
      const raw = await store.loadSignal(signalId);
      const signal = await hydrateSignal(this.env, raw);
      const result = await runSpecialize(signal, classification, {
        steps: buildOrchestrationSteps(this.env, llm),
      });

      if (mode === 'compound') {
        await store.savePartialResponse(
          resultToPartial(result, signalId, taskId, classification),
        );
      } else {
        await store.saveReviewItem(result.reviewItem);
      }
    });
  }
}

/**
 * Vertaalt een `OrchestrationResult` naar een `PartialResponse` voor de
 * fan-in tabel. De `proposed.body` uit het ReviewItem wordt hier het
 * `proposedContent` van de partial — de aggregator plakt deze paragrafen
 * later samen tot één samengesteld antwoord.
 *
 * Status-mapping:
 * - Grote confidence-drop door ungrounded claims → status='needs_human' zodat
 *   de aggregator (en reviewer) direct zien dat deze taak menselijke aandacht
 *   verdient.
 * - Anders default 'ok'.
 */
function resultToPartial(
  result: OrchestrationResult,
  signalId: string,
  taskId: string,
  classification: Classification,
): PartialResponse {
  const proposed = result.reviewItem.proposed as {
    body?: string;
    resolved?: { enrichment?: Record<string, unknown> };
  };
  const intent = (classification.specialist ??
    getIntentConfig('escalate').id) as SpecialistId;

  // Plan() heeft een eigen code-fallback voor lege bodies, dus een lege body
  // hier zou een echt uitzonderlijk geval zijn (bv. plan gooit onverwacht een
  // exception die de fallback overslaat). Signaleer 'm via status='needs_human'
  // + reason zodat de reviewer weet dat er niks bruikbaars in zat — we
  // synthetiseren geen vulling meer, dat is plan's verantwoordelijkheid.
  const body = (proposed.body ?? '').trim();
  const bodyEmpty = body.length === 0;

  // Status-hiërarchie:
  // - bodyEmpty → `needs_human` (specialist gaf niks bruikbaars terug).
  // - Ungrounded + lage confidence → `needs_human`.
  // - Anders → `ok`.
  const status: PartialResponse['status'] = bodyEmpty
    ? 'needs_human'
    : result.ungrounded.length > 0 && (result.reviewItem.confidence ?? 1) < 0.6
      ? 'needs_human'
      : 'ok';

  const reasonBits: string[] = [];
  if (bodyEmpty) reasonBits.push('specialist produceerde lege body');
  if (result.ungrounded.length > 0) {
    reasonBits.push(`ungrounded claims: ${result.ungrounded.join(', ')}`);
  }

  return {
    signalId,
    taskId,
    intent,
    status,
    resolvedRefs: refsToStringMap(classification.extracted),
    facts: proposed.resolved?.enrichment ?? {},
    proposedContent: body,
    confidence: result.reviewItem.confidence ?? 0,
    grounding: result.reviewItem.grounding ?? [],
    reason: reasonBits.length > 0 ? reasonBits.join('; ') : undefined,
    createdAt: result.reviewItem.createdAt,
  };
}

/**
 * Neemt de string-velden uit `classification.extracted` als resolvedRefs.
 * Non-string waardes (bv. object-blobs) worden overgeslagen — refs is een
 * simpele hint-map, geen payload-container.
 */
function refsToStringMap(extracted: Record<string, unknown>): Record<string, string | null> {
  const refs: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(extracted)) {
    if (typeof v === 'string') refs[k] = v;
    else if (v === null) refs[k] = null;
  }
  return refs;
}
