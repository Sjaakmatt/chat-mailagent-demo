/**
 * Orchestration-pijplijn (Build Document A6/C4): classify → resolve →
 * retrieve[if RAG] → plan → ground → ReviewItem(PENDING).
 *
 * Dit is de durable-steps-kern die een Cloudflare Workflow per stap aanroept.
 * De stappen zijn injecteerbaar (LLM, MCP-clients, memory-retriever) zodat deze
 * laag runtime- en vendor-agnostisch blijft en volledig unit-testbaar is.
 *
 * Harde garanties die hier zijn ingebakken:
 * - Output is ALTIJD een ReviewItem(PENDING). Nooit een side effect
 *   (autonomy = REVIEW default).
 * - Grounding wordt gevalideerd; niet-gedekte getallen verlagen het vertrouwen
 *   en worden als guardrail-vlag meegegeven aan de reviewer.
 */

import type {
  ReviewItem,
  ReviewItemKind,
  Signal,
  MemoryEntry,
  SpecialistId,
  TaskDescriptor,
} from '../contracts/index.js';
import {
  ToolCallRecorder,
  validateGrounding,
  type PlanClaim,
} from '../grounding/index.js';
import { getIntentConfig, type IntentConfig } from '../specialists/index.js';

export interface Classification {
  /** Categorie/triage-label (klant-specifiek). */
  category: string;
  /** 0..1 vertrouwen van de classificatie. */
  confidence: number;
  /** Heeft deze casus de RAG/memory-stap nodig? */
  needsRag: boolean;
  /** Escalatie-signaal: juridische dreiging, ernstige/risicovolle kwestie. */
  escalate?: boolean;
  /** Geëxtraheerde velden (ordernr, e.d.). */
  extracted: Record<string, unknown>;
  /**
   * Multi-agent Fase 1: welke intent-specialist gaat deze mail behandelen.
   * Optioneel voor backwards-compat — bestaande classifiers die alleen
   * `category` produceren blijven werken (de orchestrator resolvet dan géén
   * intentConfig en plan() ontvangt geen scope-hint).
   */
  specialist?: SpecialistId;
  /**
   * Multi-agent Fase 3: compound-mail-detectie. `true` als de router
   * meerdere onderscheiden vragen in dezelfde mail zag (bv. "wijzig order A
   * + status order B + moertjes ontbreken order C"). Ontbreekt / false =
   * enkelvoudige mail, huidige single-specialist-flow.
   */
  compound?: boolean;
  /**
   * Fase 3: taak-decompositie bij compound-mail. Ontbrekend/leeg = geen
   * fan-out (huidige flow). Length ≥ 2 = fan-out naar N specialisten, elk
   * met eigen ref-hints en (per taak) eigen intent.
   */
  tasks?: TaskDescriptor[];
}

/** Prioriteits-"smaak" voor de werkbak. */
export type TriageTier = "simple" | "review" | "escalate";

export interface Triage {
  tier: TriageTier;
  reason: string;
}

/** Leidt de prioriteit af uit classificatie, beleid, intent-config en grounding-zekerheid. */
export function deriveTriage(
  classification: Classification,
  policyAction: string | undefined,
  ungroundedCount: number,
  adjustedConfidence: number,
  intentConfig?: IntentConfig,
): Triage {
  // De router koos zelf voor escalatie (onbekende intent / low-confidence op alles).
  if (intentConfig?.id === 'escalate') {
    return { tier: 'escalate', reason: 'router kon niet classificeren' };
  }
  if (classification.escalate === true || policyAction === 'escalate') {
    return {
      tier: 'escalate',
      reason:
        classification.escalate === true
          ? 'mogelijke juridische/ernstige kwestie'
          : 'beleid: escalatie',
    };
  }
  // Intent-driven HITL: klacht/gdpr/technical/etc. mogen nooit auto-approved
  // worden, ongeacht confidence-cijfers.
  if (intentConfig?.needsHitl) {
    return { tier: 'review', reason: `HITL verplicht voor intent ${intentConfig.id}` };
  }
  // Confidence-drempel per intent overschrijft de generieke 0.7 zodra beschikbaar.
  if (intentConfig && adjustedConfidence < intentConfig.confidenceThreshold) {
    return {
      tier: 'review',
      reason: `confidence ${adjustedConfidence.toFixed(2)} onder intent-drempel ${intentConfig.confidenceThreshold}`,
    };
  }
  if (ungroundedCount > 0) {
    return { tier: 'review', reason: 'niet-gegronde claims' };
  }
  if (adjustedConfidence < 0.7) {
    return { tier: 'review', reason: 'lagere zekerheid' };
  }
  return { tier: 'simple', reason: 'hoge zekerheid, geen open punten' };
}

export interface ResolvedEntities {
  contactId?: string;
  dealId?: string;
  projectId?: string;
  enrichment?: Record<string, unknown>;
}

export interface Plan {
  kind: ReviewItemKind;
  summary: string;
  /** Optioneel onderwerp (voor draft_email). */
  subject?: string;
  /** De voorgestelde tekst. */
  body: string;
  /**
   * Expliciet geciteerde feitelijke claims met de tool-call die ze dekt. De
   * plan-stap legt elke gebruikte MCP-call vast in `recorder` en citeert hem
   * hier, zodat de ground-stap kan valideren.
   */
  claims: PlanClaim[];
  /** Toegepaste beleidsregel (cockpit-policy), indien gematcht. Adviserend. */
  policy?: {
    ruleId: string;
    ruleName: string;
    action?: string;
    /**
     * Of approve van deze match een klant-specifieke vervolgtaak aanmaakt.
     * De kern doet hier zelf niets mee: de vlag wordt doorgegeven aan de
     * `afterExecute`-domeinhook, die 'm invult (werkticket, CRM-update, …).
     */
    createsTask?: boolean;
  };
  /**
   * Vertrouwde bronteksten voor de grounding-check (bv. de beleidsrichtlijn en
   * de originele klantmail). Getallen die hierin staan worden niet als verzonnen
   * geflagd. Wordt niet opgeslagen op het ReviewItem.
   */
  trustedText?: string[];
  /**
   * Beleid 'no_reply': geen antwoord opstellen/versturen, alleen de mail
   * opruimen (label + verplaatsen) in Outlook bij goedkeuring. UI toont een
   * informatie-banner i.p.v. een leeg conceptveld.
   */
  noReply?: boolean;
  /** Korte reden waarom no_reply geldt (uit de beleidsrichtlijn). */
  noReplyReason?: string;
}

export interface PlanInput {
  signal: Signal;
  classification: Classification;
  resolved: ResolvedEntities;
  memory: MemoryEntry[];
  recorder: ToolCallRecorder;
  /**
   * Multi-agent Fase 1: per-intent config (prompt, tool-scope, memory-scope,
   * model-tier). Aanwezig zodra `classification.specialist` gezet is; de
   * plan-implementatie in de agent-Worker gebruikt dit om de juiste
   * system-prompt en tool-set te selecteren. Ontbreekt bij classifiers die
   * de multi-agent-shape nog niet produceren — plan valt dan terug op z'n
   * eigen defaults (backwards-compat).
   */
  intentConfig?: IntentConfig;
}

export interface OrchestrationSteps {
  classify(signal: Signal): Promise<Classification>;
  resolve(signal: Signal, classification: Classification): Promise<ResolvedEntities>;
  /** Alleen aangeroepen als `classification.needsRag` true is. */
  retrieve?(
    signal: Signal,
    classification: Classification,
    resolved: ResolvedEntities,
  ): Promise<MemoryEntry[]>;
  plan(input: PlanInput): Promise<Plan>;
}

export interface OrchestrationDeps {
  steps: OrchestrationSteps;
  now?: () => string;
  newId?: () => string;
}

export interface OrchestrationResult {
  reviewItem: ReviewItem;
  classification: Classification;
  resolved: ResolvedEntities;
  /** Niet-gedekte numerieke claims (guardrail-signaal). */
  ungrounded: string[];
}

function defaultId(): string {
  return `ri_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Verlaagt het vertrouwen wanneer er niet-gegronde getallen in de tekst staan.
 * We strippen de tekst niet automatisch (te riskant) — REVIEW vangt het op —
 * maar maken het zichtbaar via confidence + een guardrail-vlag.
 */
function adjustConfidence(base: number, ungroundedCount: number): number {
  if (ungroundedCount === 0) return base;
  return Math.max(0, base - 0.25 * ungroundedCount);
}

/**
 * Fase 2: alleen classify. Producest de `Classification` die de
 * RouterWorkflow doorgeeft aan de SpecialistWorkflow. Zo blijft `runRoute`
 * puur een router-verantwoordelijkheid en kan de specialist onafhankelijk
 * draaien (aparte Workflow-instance, eigen retry-policy, eigen observability).
 */
export async function runRoute(
  signal: Signal,
  deps: OrchestrationDeps,
): Promise<Classification> {
  return deps.steps.classify(signal);
}

/**
 * Fase 2: specialist-uitvoering na een gekozen classificatie —
 * resolve → retrieve → plan → ground → ReviewItem. Kan door een aparte
 * SpecialistWorkflow worden aangeroepen met de classificatie als input,
 * zonder dat de router weer draait.
 *
 * Voor backwards-compat blijft de gecombineerde `orchestrate()` hieronder
 * bestaan als dunne wrapper (classify + specialize).
 */
export async function runSpecialize(
  signal: Signal,
  classification: Classification,
  deps: OrchestrationDeps,
): Promise<OrchestrationResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? defaultId;
  const { steps } = deps;

  const resolved = await steps.resolve(signal, classification);

  const recorder = new ToolCallRecorder();
  const memory =
    classification.needsRag && steps.retrieve
      ? await steps.retrieve(signal, classification, resolved)
      : [];

  // Multi-agent Fase 1: als de router een specialist heeft gekozen, laad de
  // bijbehorende IntentConfig uit de registry en geef 'm door aan plan().
  // Onbekende SpecialistId → getIntentConfig() valt terug op `escalate` — de
  // plan-stap kan dan een minimalistisch antwoord bouwen en de reviewer
  // ontvangt een "kon niet classificeren"-taak.
  const intentConfig = classification.specialist
    ? getIntentConfig(classification.specialist)
    : undefined;

  const plan = await steps.plan({
    signal,
    classification,
    resolved,
    memory,
    recorder,
    intentConfig,
  });

  const { grounding, ungrounded } = validateGrounding(
    plan.body,
    plan.claims,
    recorder,
    plan.trustedText ?? [],
  );

  const proposed: Record<string, unknown> = {
    body: plan.body,
    resolved,
  };
  if (plan.subject !== undefined) proposed.subject = plan.subject;
  if (ungrounded.length > 0) proposed.guardrail = { ungroundedClaims: ungrounded };
  if (plan.policy) proposed.policy = plan.policy;

  // Snapshot van wat de agent zag (het originele, gehydrateerde signaal) en
  // besloot (classificatie). Zo kan de cockpit het origineel + de analyse tonen
  // zonder live MCP-call, en dient het als onveranderlijke audit-snapshot.
  proposed.original = signal.payload ?? {};
  proposed.classification = {
    category: classification.category,
    confidence: classification.confidence,
    extracted: classification.extracted,
    // Multi-agent Fase 1: welke intent-specialist is gekozen. Cockpit toont
    // dit als badge; UI kan de displayName opzoeken via getIntentConfig().
    specialist: classification.specialist ?? null,
  };

  const confidence = adjustConfidence(classification.confidence, ungrounded.length);
  proposed.triage = deriveTriage(
    classification,
    plan.policy?.action,
    ungrounded.length,
    confidence,
    intentConfig,
  );

  const reviewItem: ReviewItem = {
    id: newId(),
    organizationId: signal.organizationId,
    signalId: signal.id,
    kind: plan.kind,
    summary: plan.summary,
    proposed,
    confidence,
    grounding: grounding.length > 0 ? grounding : null,
    status: 'PENDING',
    createdAt: now(),
  };

  return { reviewItem, classification, resolved, ungrounded };
}

/**
 * Draait de volledige orchestratie voor één Signal: classify + specialize +
 * ReviewItem(PENDING). Backwards-compatible wrapper — de single-workflow-
 * OrchestrationWorkflow blijft dit aanroepen. Nieuwe multi-agent-code splitst
 * dezelfde stappen expliciet over Router- en SpecialistWorkflow.
 *
 * Gooit door als een stap faalt — de Workflow hervat dan vanaf die stap
 * (durable execution), zonder dubbele side effects (er zijn er geen vóór
 * EXECUTE).
 */
export async function orchestrate(
  signal: Signal,
  deps: OrchestrationDeps,
): Promise<OrchestrationResult> {
  const classification = await runRoute(signal, deps);
  return runSpecialize(signal, classification, deps);
}
