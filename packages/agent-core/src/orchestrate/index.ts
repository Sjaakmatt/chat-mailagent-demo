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
import { DOMAIN } from '../domain-gate/index.js';
import {
  finalizeOutcome,
  isIdentified,
  outcomeFromClassification,
  type Outcome,
  type OutcomeDecision,
} from '../outcomes/index.js';
import { channelForDomain } from '../channels/index.js';
import {
  buildProposedActions,
  identificationLevel,
  type ActionAttachment,
  type IdentificationLevel,
  type PlannedAction,
  type ProposedAction,
  type RejectedProposal,
} from '../actions/index.js';
import type { DecisionSource } from '../decision-log/index.js';

export interface Classification {
  /** Categorie/triage-label (klant-specifiek). */
  category: string;
  /**
   * Gezet door de domeingrens (`domain-gate`) als het bericht buiten het
   * domein valt. Is dit gevuld, dan is de run gestopt vóór de router: er is
   * geen specialist gekozen en er zijn geen tool-calls gedaan. De caller hoort
   * `outOfDomainReviewItem()` te gebruiken in plaats van door te routeren.
   */
  outOfDomain?: { reason: string } | null;
  /**
   * Voorlopige uitkomst uit de router (kennis | systeem | taak | onbekend).
   * Staat los van `specialist`: de uitkomst bepaalt de route, de specialist
   * schrijft de tekst. `systeem` is voorlopig tot `finalizeOutcome()` 'm na de
   * tool-calls bevestigt — zie `outcomes/index.ts`.
   */
  outcome?: Outcome;
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
    /**
     * Eén zin voor de klant: waarom komt er bij deze categorie een mens aan te
     * pas. Gaat letterlijk de ticketbevestiging in (`confirmationText`), dus
     * hij wordt nooit door een model aangeraakt en telt niet mee in de
     * grounding — het is beleid, geen bewering over een order.
     */
    handoverReason?: string;
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
  /**
   * Kwam er daadwerkelijk een systeemantwoord terug uit een bron-lookup
   * (order, status, tracking)? Een geslaagde call die niets vond is `false`.
   *
   * Bepaalt samen met de identificatie of een voorlopige uitkomst `systeem`
   * overeind blijft — zie `finalizeOutcome()`. Laat 'm weg als de plan-stap
   * geen bron heeft geraadpleegd; dan telt dat als geen systeemantwoord.
   */
  systemAnswer?: boolean;
  /**
   * Schrijfoperaties die de agent wil klaarzetten in een bronsysteem —
   * creditnota, adreswijziging, nalevering. Nog niets uitgevoerd: pas ná
   * goedkeuring in de werkbak gebeurt er iets.
   *
   * Wat het model hier neerzet is een **voorstel**, geen besluit. De poorten
   * eromheen (kanaal, identificatie, dekking per veld) draaien in
   * `buildProposedActions` en niet in de prompt — anders zou een model dat zich
   * vergist ook meteen zijn eigen rem kunnen loszetten.
   */
  actions?: PlannedAction[];
  /**
   * Het adres dat het bronsysteem bij de opgehaalde order/factuur teruggaf.
   *
   * Hiermee komt de identificatie van "iemand noemt een ordernummer" op
   * "het bronsysteem knoopt dit adres aan deze order". Alleen vullen als de
   * lookup echt iets teruggaf — zie `identificationLevel`.
   */
  sourceEmail?: string | null;
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
  /**
   * Domeingrens — draait vóór classify. Ontbreekt deze stap, dan is er geen
   * poort en gaat elk bericht door naar de router (het gedrag van vóór de
   * poort). Zie `domain-gate/index.ts`.
   */
  gate?(signal: Signal): Promise<{ inDomain: boolean; reason: string }>;
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

/**
 * Waar de lus mee bezig is. Bewust grof: dit is bedoeld om een wachtende
 * bezoeker te laten zien dát er iets gebeurt, niet om de architectuur te
 * lekken. De teksten die de bezoeker ziet horen bij de aanroeper, niet hier —
 * die kent de taal en de toon van de klant.
 */
export type ProgressPhase = 'routeren' | 'opzoeken' | 'schrijven' | 'doorzetten';

/** Eén gemeten stap uit de lus. Voedt het beslislog. */
export interface StepTiming {
  step: 'route' | 'resolve' | 'retrieve' | 'plan' | 'ground';
  ms: number;
}

export interface OrchestrationDeps {
  steps: OrchestrationSteps;
  now?: () => string;
  newId?: () => string;
  /**
   * Duur per stap. Net als `onProgress` fire-and-forget.
   *
   * Waarom dit er is: één getal om de hele lus vertelt je dat een beurt dertig
   * seconden kostte en verder niets. Of dat `retrieve`, `plan` of `ground` was,
   * bepaalt volledig wat je eraan doet — en zonder deze meting is het gokken.
   */
  onTiming?: (timing: StepTiming) => void;
  /**
   * Wordt aangeroepen bij elke faseovergang. Synchroon en fire-and-forget: de
   * lus wacht er niet op en een fout hierin mag de run niet raken — een
   * kapotte voortgangsmelding is geen reden om een antwoord te laten vallen.
   *
   * Alleen zinvol bij realtime kanalen. Bij mail laat je 'm weg.
   */
  onProgress?: (phase: ProgressPhase) => void;
  /**
   * Vaste tekst voor een bericht buiten het domein. Default: de tekst uit
   * `DOMAIN`. Wordt letterlijk gebruikt — nooit door een model aangeraakt.
   */
  rejectionText?: string;
}

export interface OrchestrationResult {
  reviewItem: ReviewItem;
  classification: Classification;
  resolved: ResolvedEntities;
  /** Niet-gedekte numerieke claims (guardrail-signaal). */
  ungrounded: string[];
  /** Definitieve uitkomst ná de tool-calls, inclusief eventuele degradatie. */
  outcome?: OutcomeDecision;
  /** Geraadpleegde bronnen in deze run — voedt het beslislog. */
  sources?: DecisionSource[];
  /**
   * Klaargezette schrijfoperaties, al langs alle poorten. Leeg als de plan-stap
   * er geen voorstelde of ze allemaal zijn geweigerd.
   */
  actions?: ProposedAction[];
  /**
   * Voorstellen die niet door de poort kwamen, met de reden.
   *
   * Staat naast `actions` en niet erin, want dit is geen werkvoorraad maar
   * verantwoording. Zonder deze lijst staat er in de werkbak "geen actie" en
   * kan niemand zien of dat kwam doordat er niets te doen was of doordat een
   * bedrag geen dekking had.
   */
  rejectedActions?: RejectedProposal[];
  /** Hoe zeker we weten wie dit vraagt. Bepaalde welke acties mochten ontstaan. */
  identification?: IdentificationLevel;
}

function defaultId(): string {
  return `ri_${Math.random().toString(36).slice(2, 12)}`;
}

/** Meldt een fase, en laat de run nooit struikelen over de melding zelf. */
function report(deps: OrchestrationDeps, phase: ProgressPhase): void {
  try {
    deps.onProgress?.(phase);
  } catch {
    // Bewust stil: dit is versiering, geen uitkomst.
  }
}

/**
 * Meet één stap. Ook bij een fout wordt de tijd gemeld — juist een stap die na
 * twintig seconden omvalt wil je in het log terugzien, en dat is precies de
 * meting die je kwijt bent als je alleen het geslaagde pad meet.
 */
async function meet<T>(
  deps: OrchestrationDeps,
  step: StepTiming['step'],
  run: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await run();
  } finally {
    try {
      deps.onTiming?.({ step, ms: Date.now() - start });
    } catch {
      // Zelfde afweging als bij report(): een meting mag geen beurt kosten.
    }
  }
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
 * Bouwt het ReviewItem voor een bericht dat de domeingrens niet passeert.
 *
 * De body is **letterlijk** de vaste afwijzingstekst uit config. Er komt geen
 * model aan te pas en er staat niets van het binnengekomen bericht in — dat is
 * precies de garantie die de poort geeft. Er zijn ook geen tool-calls gedaan,
 * dus er valt niets te gronden.
 *
 * Waarom tóch een ReviewItem en niet stilletjes weggooien: bij mail hoort de
 * poort-uitkomst in de werkbak (bouwbriefing §3), zodat zichtbaar is wat de
 * agent heeft afgewezen. Triage `simple` houdt het uit de aandachtsbak.
 */
export function outOfDomainReviewItem(
  signal: Signal,
  reason: string,
  rejectionText: string,
  opts: { kind?: ReviewItemKind; now?: () => string; newId?: () => string } = {},
): ReviewItem {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? defaultId;
  return {
    id: newId(),
    organizationId: signal.organizationId,
    signalId: signal.id,
    kind: opts.kind ?? 'draft_email',
    summary: `Buiten domein — ${reason || 'geen toelichting'}`,
    proposed: {
      body: rejectionText,
      original: signal.payload ?? {},
      outOfDomain: { reason },
      triage: { tier: 'simple', reason: 'buiten domein' } satisfies Triage,
    },
    // De poort is stellig: dit is geen onzekere inschatting van een antwoord.
    confidence: 1,
    grounding: null,
    status: 'PENDING',
    createdAt: now(),
  };
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
  report(deps, 'routeren');
  // In een const, niet als `deps.steps.gate`: de narrowing van de guard
  // hieronder overleeft de closure in `meet()` anders niet.
  const gateStep = deps.steps.gate;
  if (!gateStep) return meet(deps, 'route', () => deps.steps.classify(signal));

  // Poort en classificatie draaien **naast elkaar**, niet na elkaar.
  //
  // Ze hangen niet van elkaar af — de poort beoordeelt of het bericht over dit
  // bedrijf gaat, de classificatie waar het over gaat — en het zijn twee losse
  // LLM-calls, dus achter elkaar wachten kost een hele call aan tijd. Bij mail
  // maakt dat niets uit; bij chat zit er iemand naar een leeg venster te kijken.
  //
  // De veiligheidseigenschap blijft intact, en dat is hier het enige dat telt:
  // het gaat om twee **aparte prompts**. Ze delen geen context, dus een bericht
  // kan de poort nog steeds niet beïnvloeden via de routering of andersom. Wat
  // je niet mag doen is ze samenvoegen tot één call — dát zou de poort omzeilbaar
  // maken. Parallel draaien verandert alleen wanneer ze beginnen.
  //
  // Valt het bericht buiten het domein, dan wordt de classificatie **weggegooid**
  // en gaat de run niet verder: geen resolve, geen tool-calls, geen generatie.
  // Er is dus geen enkele route waarlangs die uitkomst de bezoeker bereikt.
  //
  // De prijs is een classificatie-call die je bij een geweigerd bericht voor
  // niets betaalt. Dat is de goedkope tier en de rate limiting zit ervóór, dus
  // dat weegt niet op tegen een seconde wachten bij élk bericht dat wél deugt.
  const [gate, classification] = await meet(deps, 'route', () =>
    Promise.all([
      gateStep(signal),
      deps.steps.classify(signal).catch((err: unknown) => err),
    ]),
  );

  if (!gate.inDomain) {
    return {
      category: 'buiten_domein',
      outOfDomain: { reason: gate.reason },
      confidence: 1,
      needsRag: false,
      extracted: {},
    };
  }

  // Faalde classify, dan gooien we die fout hier alsnog. Hij is opgevangen om
  // te voorkomen dat een afgewezen bericht struikelt over een call waarvan het
  // resultaat toch werd weggegooid.
  if (classification instanceof Error) throw classification;
  return classification as Classification;
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

  report(deps, 'opzoeken');
  const resolved = await meet(deps, 'resolve', () => steps.resolve(signal, classification));

  const recorder = new ToolCallRecorder();
  const retrieveStep = steps.retrieve;
  const memory =
    classification.needsRag && retrieveStep
      ? await meet(deps, 'retrieve', () => retrieveStep(signal, classification, resolved))
      : [];

  // Multi-agent Fase 1: als de router een specialist heeft gekozen, laad de
  // bijbehorende IntentConfig uit de registry en geef 'm door aan plan().
  // Onbekende SpecialistId → getIntentConfig() valt terug op `escalate` — de
  // plan-stap kan dan een minimalistisch antwoord bouwen en de reviewer
  // ontvangt een "kon niet classificeren"-taak.
  const intentConfig = classification.specialist
    ? getIntentConfig(classification.specialist)
    : undefined;

  // Bij een taak schrijft de plan-stap geen antwoord voor de bezoeker maar een
  // concept voor de werkbak. "Schrijven" is dan misleidend: iemand zit te
  // wachten op een tekst die hij nooit krijgt. Zeg wat er wél gebeurt — de
  // router weet dit al vóór de dure stap, dus dat kan op tijd.
  report(deps, classification.outcome === 'taak' ? 'doorzetten' : 'schrijven');
  const plan = await meet(deps, 'plan', () =>
    steps.plan({
      signal,
      classification,
      resolved,
      memory,
      recorder,
      intentConfig,
    }),
  );

  const { grounding, ungrounded } = await meet(deps, 'ground', async () =>
    validateGrounding(plan.body, plan.claims, recorder, plan.trustedText ?? []),
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

  // De uitkomst staat pas nu vast: `systeem` mag alleen overeind blijven als
  // de klant geïdentificeerd is én er echt een systeemantwoord terugkwam.
  // Ontbreekt een van beide, dan degradeert 'ie naar `taak` (bouwbriefing §3).
  const channel = channelForDomain(signal.domain)?.id ?? signal.domain;
  const payload = (signal.payload ?? {}) as Record<string, unknown>;
  const outcome: OutcomeDecision = finalizeOutcome(
    classification.outcome ?? outcomeFromClassification(classification),
    {
      identified: isIdentified(channel, {
        senderAddress: typeof payload.from === 'string' ? payload.from : null,
        orderReference:
          typeof classification.extracted.orderNumber === 'string'
            ? classification.extracted.orderNumber
            : null,
      }),
      systemAnswer: plan.systemAnswer === true,
    },
  );
  proposed.outcome = outcome;

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

  // Elke geregistreerde tool-call is een geraadpleegde bron. `hit` is false
  // als de call wel draaide maar niets bruikbaars opleverde — dat is precies
  // wat je in het beslislog wilt terugzien.
  const sources: DecisionSource[] = recorder.all().map((r) => ({
    id: r.toolCallId,
    tool: r.tool,
    hit: true,
  }));

  // De schrijfoperaties, ná het ReviewItem omdat ze eraan hangen.
  //
  // Het identificatieniveau wordt hier afgeleid en niet door de plan-stap
  // gemeld. Dat is bewust: het model schrijft de payload, en als het ook zijn
  // eigen zekerheid over de klant mocht opgeven, zou het de poort kunnen
  // openzetten die precies daarvoor bedoeld is.
  const identification = identificationLevel({
    senderAddress: typeof payload.from === 'string' ? payload.from : null,
    orderReference:
      typeof classification.extracted.orderNumber === 'string'
        ? classification.extracted.orderNumber
        : null,
    sourceEmail: plan.sourceEmail ?? null,
  });
  const { actions, rejected: rejectedActions } = buildProposedActions({
    planned: plan.actions ?? [],
    channel,
    identification,
    organizationId: signal.organizationId,
    runId: signal.id,
    reviewItemId: reviewItem.id,
    now: new Date(reviewItem.createdAt),
    // De bijlagen zoals het kanaal ze aanleverde. Typen die beeldmateriaal
    // eisen leunen hierop; het model komt er niet aan te pas.
    attachments: Array.isArray(payload.attachments)
      ? (payload.attachments as ActionAttachment[])
      : [],
  });

  return {
    reviewItem,
    classification,
    resolved,
    ungrounded,
    outcome,
    sources,
    actions,
    rejectedActions,
    identification,
  };
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

  // Buiten het domein: hier stopt de run. Geen resolve, geen retrieve, geen
  // plan — dus geen specialisten, geen tool-calls en geen generatie op basis
  // van het bericht. Alleen de vaste afwijzingstekst.
  if (classification.outOfDomain) {
    const reviewItem = outOfDomainReviewItem(
      signal,
      classification.outOfDomain.reason,
      deps.rejectionText ?? DOMAIN.rejectionText,
      { now: deps.now, newId: deps.newId },
    );
    return { reviewItem, classification, resolved: {}, ungrounded: [] };
  }

  return runSpecialize(signal, classification, deps);
}
