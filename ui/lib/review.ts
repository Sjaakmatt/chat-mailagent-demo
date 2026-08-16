/**
 * De generieke reviewtypes van de werkbak.
 *
 * Dit bestand is schil, geen module. Er staat niets in over mail, tickets of
 * facturen: alleen wat élk voorstel heeft — een status, een moment, een
 * prioriteit, en een kaart die de werkbak kan tekenen.
 *
 * Wat een voorstel *inhoudt* zit in `proposed`, en dat is bewust ongetypeerde
 * JSON: alleen de module die het schreef weet wat erin staat. De module vertaalt
 * het naar een `ReviewCardViewModel` (zie `lib/modules/contract.ts`); de schil
 * rendert dat viewmodel zonder te weten waar het vandaan komt.
 *
 * De werkbak draait op `public.aios_review_items`.
 */

import type { ModuleId } from "@factumai/agent-core";

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

/**
 * Prioriteits-"smaak" voor de werkbak. Schil-niveau en niet module-niveau: elk
 * proces heeft werk dat snel door kan en werk waar een mens over moet nadenken,
 * en de indeling van het scherm hangt eraan.
 */
export type TriageTier = "simple" | "review" | "escalate";

export const TRIAGE_META: Record<
  TriageTier,
  { label: string; color: "auto" | "review" | "escalate"; order: number }
> = {
  escalate: { label: "Escalatie", color: "escalate", order: 0 },
  review: { label: "Review", color: "review", order: 1 },
  simple: { label: "Simpel", color: "auto", order: 2 },
};

/**
 * Multi-agent compound: per-taak samenvatting die de aggregator meegeeft zodat
 * de reviewer per fragment ziet welke specialist het schreef en hoe zeker die
 * was.
 */
export interface CompoundTaskSummary {
  taskId: string;
  intent: string;
  status: "ok" | "needs_human" | "error";
  confidence: number;
  summary: string;
  reason?: string | null;
}

/**
 * Rij zoals die uit PostgREST komt (snake_case).
 *
 * `proposed` is met opzet `Record<string, unknown>`: de vorm ervan is van de
 * module. Wil je erbij, doe dat via de module (bv. `mailProposed(row)` in
 * `lib/modules/klantenservice.ts`) en niet met een cast ter plekke — dan blijft
 * er precies één plek waar die kennis zit.
 */
export interface ReviewItemRow {
  id: string;
  organization_id: string;
  signal_id: string | null;
  kind: string;
  /**
   * Het proces dat dit voorstel produceerde (migratie 0030). Null bij historie
   * van vóór de moduleopdeling; de registry valt dan terug op `kind`.
   */
  module: ModuleId | null;
  summary: string;
  proposed: Record<string, unknown> | null;
  confidence: number | null;
  grounding: GroundingRef[] | null;
  status: ReviewStatus;
  decided_at: string | null;
  executed_at: string | null;
  decided_by: string | null;
  created_at: string;
  compound: boolean | null;
  tasks: CompoundTaskSummary[] | null;
  precedence_intent: string | null;
}

/**
 * Eén label op een kaart. Modules bepalen wélke badges er hangen; de schil
 * bepaalt hoe ze eruitzien. Zo kan sales "offerte verlopen" tonen zonder dat de
 * werkbak weet wat een offerte is.
 */
export interface CardBadge {
  label: string;
  tone?: "neutral" | "accent" | "alert";
}

/**
 * Wat de werkbak van een voorstel tekent. Volledig module-agnostisch: geen
 * onderwerp, geen afzender, geen categorie — een titel, een ondertitel en
 * badges. Een module vult ze met wat in zijn proces de betekenis draagt.
 */
export interface ReviewCardViewModel {
  id: string;
  module: ModuleId;
  kind: string;
  /** Leesbaar label voor de vorm ("Concept", "Factuur"). Null = niet tonen. */
  kindLabel: string | null;
  /** Eerste regel: waar gaat dit over. */
  title: string;
  /** Tweede regel: om wie of wat gaat het. Null = weglaten. */
  subtitle: string | null;
  /** Derde regel: de samenvatting van de agent. */
  summary: string;
  badges: CardBadge[];
  /** Waar de detailweergave van dit item leeft. */
  href: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  confidence: number | null;
  status: ReviewStatus;
  triage: TriageTier | null;
  triageReason: string | null;
}

/** Welke statussen in welke bak vallen. */
export function bucketFor(status: ReviewStatus): "review" | "sent" | "rejected" {
  if (status === "PENDING") return "review";
  if (status === "REJECTED") return "rejected";
  return "sent"; // APPROVED | EDITED | EXECUTED
}

/**
 * De triage-tier uit een rij, als de module 'm niet zelf bepaalt. Staat hier
 * omdat de agent 'm op een vaste plek in `proposed` schrijft en elk proces die
 * conventie deelt.
 */
export function triageOf(row: ReviewItemRow): {
  tier: TriageTier | null;
  reason: string | null;
} {
  const triage = (row.proposed?.triage ?? null) as {
    tier?: string;
    reason?: string;
  } | null;
  const tier = triage?.tier;
  return {
    tier: tier && tier in TRIAGE_META ? (tier as TriageTier) : null,
    reason: triage?.reason ?? null,
  };
}
