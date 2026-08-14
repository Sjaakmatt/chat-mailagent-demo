/**
 * Numerical grounding (Build Document, harde regel 4): elke numerieke/feitelijke
 * claim in een gegenereerde tekst moet traceerbaar zijn naar een tool-call-
 * respons uit dezelfde run. De plan-stap citeert zijn claims expliciet (welke
 * tool-call dekt welke waarde); deze laag valideert dat en signaleert getallen
 * in de tekst die door géén tool-call gedekt zijn.
 */

import type { GroundingRef } from '../contracts/index.js';

/** Eén tool-call zoals tijdens een run vastgelegd, met zijn resultaat. */
export interface ToolCallRecord {
  toolCallId: string;
  /** bv. "erp.get_order_tracking" */
  tool: string;
  result?: unknown;
}

/**
 * Verzamelt de tool-calls van één orchestratie-run, zodat plan-claims aan een
 * concrete call gekoppeld kunnen worden. De plan-stap krijgt de recorder
 * binnen en legt elke MCP-call die hij gebruikt vast.
 */
export class ToolCallRecorder {
  private readonly records = new Map<string, ToolCallRecord>();

  record(rec: ToolCallRecord): void {
    this.records.set(rec.toolCallId, rec);
  }

  has(toolCallId: string): boolean {
    return this.records.has(toolCallId);
  }

  get(toolCallId: string): ToolCallRecord | undefined {
    return this.records.get(toolCallId);
  }

  all(): ToolCallRecord[] {
    return [...this.records.values()];
  }
}

/** Een door de plan-stap geciteerde claim: een waarde + de dekkende tool-call. */
export interface PlanClaim {
  /** De feitelijke/numerieke waarde zoals die in de body voorkomt. */
  value: string;
  toolCallId: string;
}

export interface GroundingResult {
  /** Gevalideerde refs voor ReviewItem.grounding. */
  grounding: GroundingRef[];
  /**
   * Numerieke tokens in de body die door géén gevalideerde claim gedekt zijn.
   * Niet-leeg ⇒ guardrail-vlag: vertrouwen omlaag, mens moet extra kijken.
   */
  ungrounded: string[];
}

/**
 * Vindt numerieke tokens in tekst: bedragen (€ 1.299,00), aantallen, order- en
 * track&trace-codes. Bewust ruim — false positives gaan naar review, geen
 * stille verzending.
 */
export function extractNumericTokens(text: string): string[] {
  const matches = text.match(/[A-Z]*\d[\w.,-]*\d|\d/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const token = raw.replace(/[.,]$/, '');
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/** True als `token` voorkomt in een van de gegronde claim-waarden. */
function isCovered(token: string, groundedValues: string[]): boolean {
  return groundedValues.some((v) => v.includes(token));
}

/**
 * Valideert de claims tegen de recorder en scant de body op niet-gedekte
 * getallen. Een claim telt alleen als grounded wanneer zijn toolCallId echt in
 * de run is vastgelegd — een verzonnen ref dekt niets.
 */
export function validateGrounding(
  body: string,
  claims: PlanClaim[],
  recorder: ToolCallRecorder,
  trustedTexts: string[] = [],
): GroundingResult {
  const grounding: GroundingRef[] = [];
  const groundedValues: string[] = [];

  for (const claim of claims) {
    const rec = recorder.get(claim.toolCallId);
    if (!rec) continue; // verzonnen/onbekende ref → telt niet
    grounding.push({ claim: claim.value, toolCallId: claim.toolCallId, tool: rec.tool });
    groundedValues.push(claim.value);
  }

  // Vertrouwde bronteksten (bv. de toegepaste beleidsrichtlijn met "2-3
  // werkdagen", of de originele klantmail) dekken óók: een getal dat daar al in
  // staat is geen door de agent verzonnen feit. Zo blijft de guardrail flaggen
  // op echt ongedekte cijfers (prijzen/codes), zonder ruis op standaardproza.
  const coverageValues = [...groundedValues, ...trustedTexts];

  const ungrounded = extractNumericTokens(body).filter(
    (token) => !isCovered(token, coverageValues),
  );

  return { grounding, ungrounded };
}
