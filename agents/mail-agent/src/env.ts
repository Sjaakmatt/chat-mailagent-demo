import type {
  Classification,
  DecisionLog,
  PartialResponse,
  Signal,
  ReviewItem,
} from '@factumai/agent-core';
import type { MailPoller } from './poller-do.js';
import type { ChatSession } from './chat/session-do.js';

/**
 * Worker-bindings voor de klant-agent (zie wrangler.jsonc). Secrets komen
 * binnen als Worker-secrets/Vault — nooit in code.
 */
export interface Env {
  /**
   * Klantnaam zoals de agent 'm in mails naar eindklanten mag noemen. Vult de
   * `{{client}}`-placeholder in de specialist-prompts. Zet 'm als `var` in
   * wrangler.jsonc — geen secret.
   */
  CLIENT_NAME?: string;

  /**
   * Domeingrens. Standaard aan. Alleen de letterlijke waarde "off" zet 'm uit —
   * dan gaat elk bericht naar de router, zoals vóór de poort bestond. Bewust
   * opt-out en geen opt-in: een ontbrekende var mag de poort niet uitschakelen.
   */
  DOMAIN_GATE?: string;

  /**
   * Zet de chat-testwidget aan op `GET /chat`. Alleen voor demo- en
   * testomgevingen; op een productie-Worker hoort deze var niet gezet te zijn.
   */
  DEMO_MODE?: string;

  /**
   * Prefix voor ticketnummers, drie letters (PREFIX-JJMM-NNNN). Ontbreekt of
   * ongeldig → "TIC". Hoort per tenant in het control plane; hier als var.
   */
  TICKET_PREFIX?: string;

  /**
   * Datacategorieën die de agent bij een MCP-call mag opvragen, als
   * komma-gescheiden lijst. Ontbreekt → `operationeel,commercieel`.
   *
   * De agent is géén gebruiker en heeft dus geen rol: hij beantwoordt de vraag
   * van een klant over diens eigen order, en daar horen bedragen bij die de
   * klant zelf ook op zijn factuur ziet. Financieel staat er bewust níét bij —
   * inkoopprijzen en marges horen niet in een antwoord aan een klant, en een
   * agent die ze niet kan opvragen, kan ze ook niet per ongeluk citeren.
   *
   * Zet 'm als `var` in wrangler.jsonc. Verruimen is een bewuste keuze per
   * klant; verkrappen kan altijd.
   */
  AGENT_DATA_CATEGORIES?: string;

  /** Klant-Supabase (waar Signal + ReviewItem leven). */
  AIOS_SUPABASE_URL: string;
  AIOS_SUPABASE_SERVICE_ROLE_KEY: string;

  /** DO-namespace voor de poller (één instance: 'aios-poller'). */
  AIOS_POLLER: DurableObjectNamespace<MailPoller>;

  /** DO-namespace voor chatsessies — één object per sessie. */
  CHAT_SESSION: DurableObjectNamespace<ChatSession>;

  /** Workflow-bindings (durable execution). */
  ORCHESTRATION: Workflow<OrchestrationParams>;
  EXECUTE: Workflow<ExecuteParams>;
  /**
   * Fase 2 multi-agent — parallel aan ORCHESTRATION. De poller start
   * ROUTER i.p.v. ORCHESTRATION zodra `USE_MULTI_AGENT_ROUTER=true`.
   */
  ROUTER: Workflow<RouterParams>;
  SPECIALIST: Workflow<SpecialistParams>;
  /**
   * Fase 3 — compound fan-in. Router spawnt de aggregator alleen als hij
   * fan-out doet (tasks.length ≥ 2). De aggregator wacht tot alle N
   * partials in aios_partial_responses staan en weeft ze samen tot
   * één compound ReviewItem.
   */
  AGGREGATOR: Workflow<AggregatorParams>;

  /**
   * Feature-flag: "true" laat de poller ROUTER (multi-agent split) starten
   * i.p.v. ORCHESTRATION (single-workflow). Ontbrekend / andere waarde =
   * oud gedrag. Zo kunnen we snel terugschakelen zonder redeploy.
   */
  USE_MULTI_AGENT_ROUTER?: string;

  /** Model-IDs uit config (A11 — niet hardcoden). */
  MODEL_CLASSIFY: string;
  MODEL_PLAN: string;
  /**
   * Optioneel Opus-tier model voor de `technical`-specialist (vision-analyse
   * op defect-foto's + complexer redeneren). Ontbreekt → val terug op
   * MODEL_PLAN (Sonnet). Wordt alleen gebruikt als een IntentConfig
   * `modelTierHint: 'plan-heavy'` heeft.
   */
  MODEL_PLAN_HEAVY?: string;

  /** Anthropic API-key (secret). Later per tenant Bedrock/Vertex-EU. */
  ANTHROPIC_API_KEY: string;

  /** RAG/few-shot aan voor deze tenant ("true"). Vereist VOYAGE_API_KEY. */
  AIOS_RAG_ENABLED?: string;
  /** Voyage AI API-key voor embeddings (voyage-3.5, 1024 dim → vector(1024)). */
  VOYAGE_API_KEY?: string;
  /** Embedding-model uit config (default voyage-3.5). */
  MODEL_EMBED?: string;

  /** Domein-MCP endpoints (streamable HTTP /mcp) + bearer. */
  FACTUMAI_MCP_CRM_URL?: string;
  FACTUMAI_MCP_ERP_URL?: string;
  FACTUMAI_MCP_MAIL_URL?: string;
  FACTUMAI_MCP_SHIPPING_URL?: string;
  FACTUMAI_MCP_API_KEY?: string;
  /**
   * Gedeeld inbound-secret dat de FactumAI-MCPs afdwingen op elke `/mcp`-request
   * (audit K3). Zelfde waarde als `MCP_INBOUND_SECRET` op de MCP-workers; zonder
   * dit levert elke MCP-call 401 op. Voorkeur boven `FACTUMAI_MCP_API_KEY` —
   * die laatste blijft als fallback voor lokale/legacy setups.
   * Alleen relevant voor de oude `*.workers.dev`-URL's — de custom domains
   * (`mcp-<x>.factumai.nl`) doen inbound-auth via Cloudflare Access.
   */
  FACTUMAI_MCP_INBOUND_SECRET?: string;

  /**
   * Cloudflare Access service-token voor de custom-domain MCPs
   * (`https://mcp-<x>.factumai.nl/mcp`). Beide vereist; Access antwoordt anders
   * met 403 aan de edge. Zet via `wrangler secret put` — nooit in code/vars.
   */
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

  /**
   * Outlook netjes houden na afhandeling (best-effort, breekt het versturen
   * nooit). `MAIL_DONE_LABEL`: categorie/label op de afgehandelde mail (default
   * "AIOS afgehandeld"; leeg = niet labelen). `MAIL_DONE_FOLDER`: well-known
   * naam (bv. "archive") of folder-id om de mail naartoe te verplaatsen; leeg =
   * niet verplaatsen.
   */
  MAIL_DONE_LABEL?: string;
  MAIL_DONE_FOLDER?: string;

  /**
   * Welke vendor stuurt de daadwerkelijke mail naar de klant?
   *   'graph'  → mail-MCP `mail_reply` via Microsoft Graph (default).
   *   'resend' → Resend HTTPS API; we behouden thread via In-Reply-To /
   *              References-headers, posten een kopie in Outlook Sent items
   *              via `mail_save_to_sent`, en markeren de originele mail
   *              als beantwoord. Vereist RESEND_API_KEY + RESEND_FROM.
   * Terugschakelen = `MAIL_SEND_VIA=graph` op de Worker zetten.
   */
  MAIL_SEND_VIA?: 'graph' | 'resend';
  RESEND_API_KEY?: string;
  /** Afzender bij Resend (bv. "Klantnaam <mail-agent@factumai.nl>"). */
  RESEND_FROM?: string;

  /** Tenant (FactumAI org-id van deze klant). */
  AIOS_ORG_ID: string;
}

/** Params waarmee de poller de Orchestration-Workflow start. */
export interface OrchestrationParams {
  signalId: string;
}

/** Params waarmee de cockpit (na approve) de Execute-Workflow start. */
export interface ExecuteParams {
  reviewItemId: string;
  /** = pgmq msg_id van de execute-message; idempotency-key. */
  idempotencyKey: string;
}

/** Router-Workflow (Fase 2): classificeert het Signal en dispatched een specialist. */
export interface RouterParams {
  signalId: string;
}

/**
 * Specialist-Workflow (Fase 2/3): pakt een gerouteerd Signal + classificatie op
 * en doet resolve → retrieve → plan → ground.
 *
 * Twee modi:
 * - `mode='single'`  (default) — één specialist per Signal, output = ReviewItem
 *   direct in `aios_review_items`. Fase 2 gedrag.
 * - `mode='compound'` — deel-antwoord in een fan-out; output = PartialResponse
 *   in `aios_partial_responses`. De aggregator weeft alle partials daarna
 *   tot één ReviewItem.
 */
export interface SpecialistParams {
  signalId: string;
  classification: Classification;
  /** Stabiele identifier binnen deze Signal; default 'primary' voor niet-compound. */
  taskId?: string;
  /** Bepaalt of de specialist een ReviewItem of een PartialResponse schrijft. */
  mode?: 'single' | 'compound';
}

/**
 * Aggregator-Workflow (Fase 3): wacht tot alle N verwachte PartialResponses
 * voor deze Signal in `aios_partial_responses` staan, weeft ze samen tot één
 * compound ReviewItem. Idempotent op signalId (Cloudflare dedupt via id).
 */
export interface AggregatorParams {
  signalId: string;
  /** Aantal specialisten dat de router heeft dispatched. */
  expectedTasks: number;
}

/** Smalle interface naar de platform-DB voor de Workflows (scaffold). */
export interface PlatformStore {
  loadSignal(signalId: string): Promise<Signal>;
  saveReviewItem(item: ReviewItem): Promise<void>;
  loadReviewItem(reviewItemId: string): Promise<ReviewItem>;
  markSignal(signalId: string, status: Signal['status']): Promise<void>;

  // ── Fase 3 — compound-fan-in ──────────────────────────────────────────
  /**
   * Upsert een PartialResponse. Idempotent op `(signal_id, task_id)` —
   * herhaalde starts van dezelfde specialist-instance vervangen de rij i.p.v.
   * te dupliceren.
   */
  savePartialResponse(partial: PartialResponse): Promise<void>;
  /** Alle partials voor een signaal, oplopend op `created_at`. */
  listPartialResponses(signalId: string): Promise<PartialResponse[]>;
  /** Snelle telling voor de aggregator-wachtgang. */
  countPartialResponses(signalId: string): Promise<number>;

  /**
   * Best-effort: schrijf het beslislog van deze run. Idempotent op signalId.
   * Faalt nooit door: het log is er om te reconstrueren, niet om de
   * afhandeling te blokkeren.
   */
  saveDecisionLog(log: DecisionLog): Promise<void>;

  /**
   * Best-effort: log een rij in `aios_unknown_intent_log` als de router
   * onder de confidence-drempel bleef of in de escalate-fallback belandde.
   * Voedt de latere auto-discovery-clustering.
   */
  saveUnknownIntent(entry: UnknownIntentEntry): Promise<void>;
}

/** Rij die de router in `aios_unknown_intent_log` schrijft. */
export interface UnknownIntentEntry {
  id: string;
  signalId: string;
  routerReasoning: string;
  /** Top-N kandidaten met score, bv. [{specialist: "escalate", score: 0.35}]. */
  routerTopCandidates: Array<{ specialist: string; score: number }>;
  /** 1-2 zin samenvatting van de mail. */
  mailSummary: string;
}
