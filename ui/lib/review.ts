/**
 * Lokale typedefs + mapping voor de AIOS-werkbak. Géén import uit de oude
 * mail-store: de cockpit draait nu op `public.aios_review_items`.
 */

export type ReviewStatus =
  | "PENDING"
  | "APPROVED"
  | "EDITED"
  | "REJECTED"
  | "EXECUTED";

export interface GroundingRef {
  claim: string;
  tool: string;
}

/** Prioriteits-"smaak" voor de werkbak. */
export type TriageTier = "simple" | "review" | "escalate";

export const TRIAGE_META: Record<
  TriageTier,
  { label: string; color: "auto" | "review" | "escalate"; order: number }
> = {
  escalate: { label: "Escalatie", color: "escalate", order: 0 },
  review: { label: "Review", color: "review", order: 1 },
  simple: { label: "Simpel", color: "auto", order: 2 },
};

export interface ProposedContent {
  subject?: string;
  body?: string;
  /** Snapshot van de originele (gehydrateerde) mail die de agent verwerkte. */
  original?: {
    subject?: string;
    bodyText?: string;
    from?: string;
    messageId?: string;
    receivedDateTime?: string;
    thread?: {
      id?: string;
      from?: string;
      subject?: string;
      receivedDateTime?: string;
      bodyPreview?: string;
      isRead?: boolean;
    }[];
    attachments?: {
      id: string;
      name: string;
      contentType?: string;
      size?: number;
      path?: string | null;
      note?: string;
    }[];
    [key: string]: unknown;
  };
  /** Triage-uitkomst van de classify-stap. */
  classification?: {
    category?: string;
    confidence?: number;
    extracted?: Record<string, unknown>;
    /**
     * Multi-agent: welke specialist heeft het concept geproduceerd (bij
     * single-intent). Bij compound zit deze info per-task in `tasks[].intent`
     * op de top-level rij.
     */
    specialist?: string | null;
  };
  /** Toegepaste beleidsregel (cockpit-policy), indien gematcht. */
  policy?: {
    ruleId?: string;
    ruleName?: string;
    action?: string;
  };
  /** Prioriteits-"smaak" (door de agent afgeleid). */
  triage?: {
    tier?: TriageTier;
    reason?: string;
  };
  resolved?: {
    enrichment?: {
      messageId?: string;
      toEmail?: string;
    };
  };
  guardrail?: {
    ungroundedClaims?: string[];
  };
  /** Beleid 'no_reply': geen concept; bij approve wordt de mail alleen opgeruimd. */
  noReply?: boolean;
  noReplyReason?: string;
  [key: string]: unknown;
}

/**
 * Multi-agent compound: per-task samenvatting die de aggregator meegeeft
 * zodat de reviewer per fragment ziet welke specialist het schreef en hoe
 * zeker die was. `intent` correspondeert met de SpecialistId uit agent-core.
 */
export interface CompoundTaskSummary {
  taskId: string;
  intent: string;
  status: "ok" | "needs_human" | "error";
  confidence: number;
  summary: string;
  reason?: string | null;
}

/** Rij zoals die uit PostgREST komt (snake_case). */
export interface ReviewItemRow {
  id: string;
  organization_id: string;
  signal_id: string | null;
  kind: string;
  summary: string;
  proposed: ProposedContent | null;
  confidence: number | null;
  grounding: GroundingRef[] | null;
  status: ReviewStatus;
  decided_at: string | null;
  executed_at: string | null;
  decided_by: string | null;
  created_at: string;
  /**
   * Multi-agent compound: true = de aggregator heeft dit item samengeweven
   * uit meerdere PartialResponses. Ontbreekt of false = klassiek
   * single-intent item van één specialist.
   */
  compound: boolean | null;
  /**
   * Per-task-samenvattingen (alleen gevuld bij compound=true). Zelfde
   * volgorde als de fragmenten in `proposed.body`.
   */
  tasks: CompoundTaskSummary[] | null;
  /**
   * Multi-agent compound: welke intent bepaalde de eindtoon (bv. klacht
   * wint van simple_reply). Cockpit toont deze als "primaire toon"-badge.
   */
  precedence_intent: string | null;
}

/**
 * SpecialistId (uit agent-core) → leesbaar Nederlands label voor cockpit-
 * badges. Bewust simpel: als de router een onbekende (experimentele)
 * specialist meegeeft, valt `specialistLabel()` terug op de slug zelf.
 */
export const SPECIALIST_LABELS: Record<string, string> = {
  simple_reply: "Simpel antwoord",
  order_change: "Orderwijziging",
  complaint: "Klacht",
  technical: "Technisch",
  gdpr: "Privacy / GDPR",
  escalate: "Escalatie",
};

export function specialistLabel(slug?: string | null): string | null {
  if (!slug) return null;
  return SPECIALIST_LABELS[slug] ?? slug;
}

/**
 * Slug → leesbaar label voor de classificatie-categorie. Komt uit de gedeelde
 * taxonomie in agent-core, zodat cockpit en agent nooit uit de pas lopen —
 * pas categorieën dáár aan, niet hier.
 */
import { categoryLabel } from "@factumai/agent-core";

export { CATEGORY_LABELS, categoryLabel } from "@factumai/agent-core";

/** Compact viewmodel voor de kaart in de werkbak. */
export interface ReviewCardViewModel {
  id: string;
  kind: string;
  summary: string;
  subject: string;
  customer: string | null;
  category: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  confidence: number | null;
  status: ReviewStatus;
  triage: TriageTier | null;
  triageReason: string | null;
  /**
   * Multi-agent: welke specialist heeft het concept geproduceerd.
   * - Bij single-intent: `classification.specialist`
   * - Bij compound:     `precedence_intent` (de intent die de eindtoon bepaalt)
   * Cockpit toont dit als badge naast de categorie.
   */
  specialist: string | null;
  /** Multi-agent compound: aantal sub-tasks in dit item (0 = single-intent). */
  taskCount: number;
}

/** Best-effort afzendernaam/-adres uit de gehydrateerde mail. */
function customerFrom(proposed: ProposedContent | null): string | null {
  const raw =
    proposed?.original?.from ??
    proposed?.resolved?.enrichment?.toEmail ??
    proposed?.original?.thread?.[0]?.from ??
    null;
  if (!raw) return null;
  // "Naam <mail@x.nl>" → "Naam"; kale mail → het mailadres zelf.
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : raw).trim() || null;
}

export function toCardViewModel(row: ReviewItemRow): ReviewCardViewModel {
  const tier = row.proposed?.triage?.tier ?? null;
  // Bij compound wint precedence_intent (aggregator-keuze); anders het
  // single-intent specialist-veld uit de classificatie.
  const specialist = row.compound
    ? row.precedence_intent
    : (row.proposed?.classification?.specialist ?? null);
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    subject: row.proposed?.subject ?? row.summary,
    customer: customerFrom(row.proposed),
    category: categoryLabel(row.proposed?.classification?.category),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    confidence: row.confidence,
    status: row.status,
    triage: tier && tier in TRIAGE_META ? tier : null,
    triageReason: row.proposed?.triage?.reason ?? null,
    specialist,
    taskCount: row.tasks?.length ?? 0,
  };
}

/** Welke statussen in welke triage-bucket vallen. */
export function bucketFor(status: ReviewStatus): "review" | "sent" | "rejected" {
  if (status === "PENDING") return "review";
  if (status === "REJECTED") return "rejected";
  return "sent"; // APPROVED | EDITED | EXECUTED
}
