/**
 * Beslislog — één regel per run, met wat de agent deed en waarom.
 *
 * Doel is niet "loggen" in de gebruikelijke zin. Het doel is dat een mens
 * achteraf de vraag *waarom antwoordde hij dit?* kan beantwoorden zonder de
 * code te lezen: welke stappen draaiden, welke bronnen werden geraadpleegd,
 * welk model besloot wat, en waar het is afgeweken van het voor de hand
 * liggende pad.
 *
 * Daarom staan hier de **afwijkingen** centraal. Een run die netjes door alle
 * stappen liep is één regel; een run waarin de poort dichtsloeg, de uitkomst
 * degradeerde of de grounding een claim afkeurde, laat precies zien wáár dat
 * gebeurde. Dat is wat je nodig hebt als een klant belt over een antwoord van
 * drie weken geleden.
 *
 * Bewust géén vrije tekst van een model erin: alle redenen komen uit code of
 * uit een vast veld. Een beslislog dat je niet kunt vertrouwen is erger dan
 * geen beslislog.
 */

import type { GroundingRef } from '../contracts/index.js';
import type { OutcomeDecision } from '../outcomes/index.js';

/** Eén stap in de run, in de volgorde waarin hij draaide. */
export interface DecisionStep {
  /** gate | classify | resolve | retrieve | plan | ground | execute */
  step: string;
  /** Verstreken tijd in ms. Weggelaten als niet gemeten. */
  ms?: number;
  /** Model-id als deze stap een LLM raadpleegde. */
  model?: string;
  /** Eén regel: wat leverde deze stap op. Uit code, niet uit een model. */
  outcome?: string;
}

/** Een geraadpleegde bron: een MCP-call, een DB-lookup, een memory-hit. */
export interface DecisionSource {
  /** Stabiele id, gelijk aan de toolCallId uit de grounding-recorder. */
  id: string;
  /** Welke tool/bron, bv. "erp.get_order". */
  tool: string;
  /** Leverde de call iets bruikbaars op? */
  hit: boolean;
}

export interface DecisionLog {
  /** Gelijk aan het Signal — zo vind je de run terug vanaf de mail. */
  signalId: string;
  organizationId: string;
  /** Gevuld zodra er een ReviewItem uit kwam. */
  reviewItemId?: string | null;
  /** mail | chat | … */
  channel: string;

  /** Poortoordeel. `false` betekent: de run stopte hier. */
  inDomain: boolean;
  domainReason?: string;

  /** Gekozen categorie + specialist, als de run zover kwam. */
  category?: string | null;
  specialist?: string | null;

  /** Definitieve uitkomst, inclusief degradatie. */
  outcome?: OutcomeDecision | null;

  steps: DecisionStep[];
  sources: DecisionSource[];

  /** Claims die niet herleidbaar bleken. Leeg is goed nieuws. */
  ungrounded: string[];
  grounding?: GroundingRef[] | null;

  /** Vertrouwen ná de grounding-correctie. */
  confidence?: number | null;
  createdAt: string;
}

/**
 * De afwijkingen in deze run, als korte regels. Dit is wat je in de cockpit
 * bovenaan wilt zien — de rest is detail.
 *
 * Levert een lege lijst op als er niets bijzonders gebeurde; dat is zelf ook
 * informatie ("gewoon door de lus gelopen").
 */
export function notableEvents(log: DecisionLog): string[] {
  const out: string[] = [];

  if (!log.inDomain) {
    out.push(`Buiten domein — ${log.domainReason || 'geen toelichting'}`);
    // Verder is er niets gebeurd; de rest zou verwarrend zijn.
    return out;
  }

  if (log.outcome?.degradedFrom) {
    out.push(
      `Uitkomst verlaagd van ${log.outcome.degradedFrom} naar ${log.outcome.outcome} — ${log.outcome.reason}`,
    );
  }

  const missed = log.sources.filter((s) => !s.hit);
  if (missed.length > 0) {
    out.push(`Bron zonder resultaat: ${missed.map((s) => s.tool).join(', ')}`);
  }

  if (log.ungrounded.length > 0) {
    out.push(`Niet-herleidbare claims: ${log.ungrounded.join(', ')}`);
  }

  if (typeof log.confidence === 'number' && log.confidence < 0.7) {
    out.push(`Lage zekerheid (${log.confidence.toFixed(2)})`);
  }

  return out;
}

/** Draaide de run helemaal door zonder bijzonderheden? */
export function ranClean(log: DecisionLog): boolean {
  return notableEvents(log).length === 0;
}

/** Rij zoals `aios_decision_logs` 'm opslaat (snake_case). */
export interface DecisionLogRow {
  id: string;
  signal_id: string;
  organization_id: string;
  review_item_id: string | null;
  channel: string;
  in_domain: boolean;
  domain_reason: string | null;
  category: string | null;
  specialist: string | null;
  outcome: OutcomeDecision | null;
  steps: DecisionStep[];
  sources: DecisionSource[];
  ungrounded: string[];
  grounding: GroundingRef[] | null;
  confidence: number | null;
  created_at: string;
}

export function toDecisionLogRow(log: DecisionLog, id: string): DecisionLogRow {
  return {
    id,
    signal_id: log.signalId,
    organization_id: log.organizationId,
    review_item_id: log.reviewItemId ?? null,
    channel: log.channel,
    in_domain: log.inDomain,
    domain_reason: log.domainReason ?? null,
    category: log.category ?? null,
    specialist: log.specialist ?? null,
    outcome: log.outcome ?? null,
    steps: log.steps,
    sources: log.sources,
    ungrounded: log.ungrounded,
    grounding: log.grounding ?? null,
    confidence: log.confidence ?? null,
    created_at: log.createdAt,
  };
}

export function fromDecisionLogRow(row: DecisionLogRow): DecisionLog {
  return {
    signalId: row.signal_id,
    organizationId: row.organization_id,
    reviewItemId: row.review_item_id,
    channel: row.channel,
    inDomain: row.in_domain,
    domainReason: row.domain_reason ?? undefined,
    category: row.category,
    specialist: row.specialist,
    outcome: row.outcome,
    steps: Array.isArray(row.steps) ? row.steps : [],
    sources: Array.isArray(row.sources) ? row.sources : [],
    ungrounded: Array.isArray(row.ungrounded) ? row.ungrounded : [],
    grounding: row.grounding,
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}
