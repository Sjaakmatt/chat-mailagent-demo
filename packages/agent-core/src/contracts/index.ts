/**
 * Canonieke AIOS-contracten (Platform Build Document A7). Eén gedeeld
 * datamodel — een klant is data + config, geen schema-duplicatie. Deze types
 * spiegelen het Prisma-model in de platform-Supabase; agent-core werkt er
 * runtime-agnostisch mee (geen Prisma-runtime-afhankelijkheid in deze laag).
 *
 * Zod-schemas voor validatie leven in `./schemas.ts` — re-exported onderaan.
 */

export type MemoryScope = 'GLOBAL' | 'CLIENT' | 'PROCESS';
export type SignalStatus = 'NEW' | 'PROCESSING' | 'DONE' | 'IGNORED' | 'FAILED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'EDITED' | 'REJECTED' | 'EXECUTED';
export type Autonomy = 'REVIEW' | 'AUTO';

/** Few-shot feedback-label: GOOD = nastreven, BAD = vermijden. */
export type MemoryLabel = 'GOOD' | 'BAD';

/** Genormaliseerd inbound event (vendor-agnostisch). */
export interface Signal {
  id: string;
  organizationId: string;
  /** mail | chat | calendar | dev | erp | bank | crm | manual */
  domain: string;
  /** mail.received | call.transcribed | invoice.due | payment.in | ... */
  type: string;
  payload: Record<string, unknown>;
  status: SignalStatus;
  contactId?: string | null;
  dealId?: string | null;
  projectId?: string | null;
  idempotencyKey?: string | null;
  receivedAt: string;
  processedAt?: string | null;
}

/** draft_email | crm_update | calendar_event | invoice | social_post | task | ... */
/**
 * Het proces waar een voorstel uit komt — klantenservice, sales, administratie,
 * operations. Staat hier en niet in `modules/` omdat het een contractwaarde is
 * die de kern én de schil delen; `modules/` bouwt erop voort zonder dat
 * contracts iets van modules hoeft te weten.
 *
 * Open union, net als `ReviewItemKind`: een klant mag een eigen proces
 * toevoegen zonder deze lijst te wijzigen.
 */
export type ModuleId =
  | 'klantenservice'
  | 'sales'
  | 'administratie'
  | 'operations'
  | (string & {});

export type ReviewItemKind =
  | 'draft_email'
  | 'crm_update'
  | 'calendar_event'
  | 'invoice'
  | 'social_post'
  | 'task'
  | (string & {});

/**
 * Eén grounding-ref: een feitelijke/numerieke claim gekoppeld aan de tool-call
 * uit dezelfde run die hem dekt (Build Document, harde regel 4 — numerical
 * grounding). Zonder dekkende ref hoort een cijfer/claim niet in de output.
 */
export interface GroundingRef {
  /** De claim/waarde zoals die in de tekst staat (bv. "track-and-trace 3SABC"). */
  claim: string;
  /** toolCallId uit de ToolCallRecorder van dezelfde run. */
  toolCallId: string;
  /** Welke tool de claim dekte, bv. "erp.get_order_tracking". */
  tool: string;
}

/**
 * Een voorgestelde actie die wacht op menselijke goedkeuring. De orchestrator
 * produceert ALTIJD een ReviewItem(PENDING) — nooit een directe side effect
 * (autonomy = REVIEW default).
 */
export interface ReviewItem {
  id: string;
  organizationId: string;
  signalId?: string | null;
  kind: ReviewItemKind;
  /**
   * Het proces dat dit voorstel produceerde — klantenservice, sales,
   * administratie, operations. Bepaalt in welke tab van de werkbak het item
   * landt en wie het mag goedkeuren.
   *
   * Optioneel omdat items van vóór de moduleopdeling 'm niet dragen; de schil
   * valt dan terug op `kind`. Nieuwe schrijvers vullen 'm altijd.
   */
  module?: ModuleId | null;
  summary: string;
  /** De concrete voorgestelde inhoud (bv. { subject, body } voor een draft_email). */
  proposed: Record<string, unknown>;
  confidence?: number | null;
  grounding?: GroundingRef[] | null;
  status: ReviewStatus;
  createdAt: string;
  decidedAt?: string | null;
  executedAt?: string | null;
  /**
   * Compound-flag: `true` als deze ReviewItem een samengesteld antwoord is
   * (aggregator over meerdere PartialResponses). Bij `false`/`null` blijft
   * gedrag identiek aan de single-intent flow.
   */
  compound?: boolean | null;
  /** Per-taak samenvatting; aanwezig ⇔ `compound=true`. */
  tasks?: CompoundTaskSummary[] | null;
  /** Zie CompoundMetadata.precedenceIntent. */
  precedenceIntent?: SpecialistId | null;
}

export interface MemoryEntry {
  id: string;
  organizationId: string;
  scope: MemoryScope;
  pinned: boolean;
  title: string;
  body: string;
  /** pgvector; mistral-embed = 1024 dim. In de app/Workflow-laag, nooit in een MCP. */
  embedding?: number[] | null;
  source: string;
  sourceRef?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  projectId?: string | null;
  createdAt: string;
  /**
   * Feedback-label (alleen voor `source = "feedback"`): GOOD = goedgekeurd/
   * gecorrigeerd voorbeeld om na te streven, BAD = afgewezen voorbeeld om te
   * vermijden. Few-shot only — geen finetuning.
   */
  label?: MemoryLabel | null;
  /** Bij een EDIT: de oorspronkelijke (afgekeurde) concept-versie; de diff met
   *  `body` is het primaire leersignaal. */
  supersededDraft?: string | null;
}

export interface Automation {
  id: string;
  organizationId: string;
  name: string;
  trigger: string;
  schedule?: string | null;
  autonomy: Autonomy;
  enabled: boolean;
  toolScope: string[];
  config?: Record<string, unknown> | null;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-agent contracten (router → specialist → aggregator)
// ────────────────────────────────────────────────────────────────────────────

/**
 * De set van specialisten die de router mag kiezen. Kern-specialisten zijn
 * hard gecodeerd; `string & {}` laat data-driven experimentele specialisten
 * toe zonder de type te breken (zie AIOS-briefing "hybride model").
 */
export type SpecialistId =
  | 'simple_reply'
  | 'order_change'
  | 'complaint'
  | 'technical'
  | 'gdpr'
  | 'escalate'
  | (string & {});

/**
 * Signaalflag-set die de router uit de mail-inhoud haalt. Losstaand van de
 * intent-keuze, want dezelfde intent kan met/zonder image of urgentie komen.
 */
export interface IntentFlags {
  hasImage: boolean;
  urgent: boolean;
  juridicalLanguage: boolean;
  gdprSignals: boolean;
  complaintSignals: boolean;
  compound: boolean;
  /** Bij compound=true en gemengde intents: de belangrijkste secundaire. */
  secondary?: SpecialistId | null;
}

/**
 * Één deelvraag/-taak binnen een mogelijk compound mail. Refs zijn HINTS
 * (bv. "meest recente", "eerdere bestelling met moertjes") — de specialist
 * resolvet zelf tegen BC/Woo/etc. Zo hoeft de router geen order-IDs uit
 * context te fabuleren.
 */
export interface TaskDescriptor {
  /** Stabiele identifier binnen deze Signal: "t0", "t1", ... */
  id: string;
  intent: SpecialistId;
  /** Korte samenvatting van waar deze taak over gaat. */
  subject: string;
  /**
   * Expliciete briefing die de router (hoofdagent) aan de specialist geeft
   * bij compound-fan-out. 2-3 zinnen die zeggen "wat moet deze specialist
   * doen", herformuleerd uit de klant-mail. Vervangt de rauwe mail-body als
   * user-content bij de plan-LLM — de specialist mag NIET het volledige
   * bericht zien om te voorkomen dat hij het andere deel meepakt.
   *
   * Optioneel voor single-intent flows en backwards-compat.
   */
  briefing?: string;
  /** Vrije-vorm hints; specialist-specifiek. Waarden mogen `null` zijn. */
  refs: Record<string, string | null>;
  /** Extra per-taak flags (taal, urgentie, subcategorie). */
  flags?: Record<string, string | number | boolean> | null;
}

/**
 * Router-output: classificatie + decompositie in één structured-output-shape.
 * Bij `compound=false` bevat `tasks` één element met de hoofd-intent —
 * dat houdt downstream-code uniform (altijd een task-lijst).
 */
export interface IntentClassification {
  primary: SpecialistId;
  /** 0..1; wordt gebruikt om `lowConfidence` te bepalen (drempel per specialist). */
  confidence: number;
  compound: boolean;
  tasks: TaskDescriptor[];
  flags: IntentFlags;
  /** Vrije-vorm redenering — audit + auto-discovery-log input. */
  reasoning: string;
  /** True zodra de highest score onder de router-drempel valt. */
  lowConfidence?: boolean;
  /** Top-3 kandidaten met score, voor audit + clustering. */
  topCandidates?: Array<{ specialist: SpecialistId; score: number }>;
}

/** Uitkomstniveau van één specialist-run. */
export type PartialResponseStatus =
  | 'ok'
  | 'needs_human' // specialist kon niet resolven, of policy dwingt review
  | 'error'; // tool-call faalde permanent

/**
 * Wat een specialist teruggeeft. Deze rijen leven in `aios_partial_responses`
 * (migratie 0016) en zijn de fan-in-input voor de aggregator. Bewust GÉÉN
 * volledige mail-body — dat is het werk van de aggregator.
 */
export interface PartialResponse {
  signalId: string;
  taskId: string;
  intent: SpecialistId;
  status: PartialResponseStatus;
  /** IDs die de specialist bewezen heeft (bv. `{ orderId: "SO-2024-1287" }`). */
  resolvedRefs: Record<string, string | null>;
  /** Facts uit tool-calls — inputs voor de aggregator-prompt. */
  facts: Record<string, unknown>;
  /** Voorgesteld deel-antwoord (paragraaf-niveau), niet compleet mail-body. */
  proposedContent: string;
  confidence: number;
  grounding: GroundingRef[];
  /** Audit-log van welke tools de specialist heeft aangeroepen. */
  toolCalls?: PartialToolCall[];
  /** Bij `needs_human` / `error`: uitleg voor de reviewer. */
  reason?: string | null;
  createdAt: string;
}

export interface PartialToolCall {
  tool: string;
  params: Record<string, unknown>;
  /**
   * Rauwe tool-respons. Optioneel omdat `void`/effect-only tools geen return
   * kunnen hebben — de Zod-inference voor `z.any()` behandelt deze veld
   * hoe dan ook als optional.
   */
  result?: unknown;
  ok: boolean;
  toolCallId?: string;
}

/**
 * Metadata die op een compound `ReviewItem` hangt. Bij `compound=false` blijft
 * dit veld leeg — bestaande single-intent flows raakt dit niet.
 */
export interface CompoundMetadata {
  compound: true;
  tasks: CompoundTaskSummary[];
  /**
   * Als één specialist precedence claimde (bv. klacht overrulet neutrale
   * status-vraag), dan wordt de toon van de complete mail door die intent
   * bepaald. `null` betekent: geen precedence, aggregator kiest neutraal.
   */
  precedenceIntent?: SpecialistId | null;
}

export interface CompoundTaskSummary {
  taskId: string;
  intent: SpecialistId;
  status: PartialResponseStatus;
  confidence: number;
  /** Korte samenvatting van welk deel van de mail-body deze taak dekt. */
  summary: string;
  reason?: string | null;
}

export * from './schemas.js';
