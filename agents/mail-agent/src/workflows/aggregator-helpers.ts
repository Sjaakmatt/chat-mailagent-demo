/**
 * Pure helpers voor de AggregatorWorkflow — géén Cloudflare-imports, zodat
 * ze in vitest getest kunnen worden zonder een `cloudflare:workers`-module
 * te hoeven mocken.
 */

import {
  getIntentConfig,
  type CompoundTaskSummary,
  type GroundingRef,
  type PartialResponse,
  type ReviewItem,
  type SpecialistId,
} from '@factumai/agent-core';

/**
 * Kiest de intent die de toon van de samengestelde mail bepaalt. Regel:
 * eerste `needsHitl`-intent uit de partials wint; anders `null` (aggregator
 * neemt neutrale toon).
 */
export function pickPrecedence(partials: PartialResponse[]): SpecialistId | null {
  for (const p of partials) {
    const cfg = getIntentConfig(p.intent);
    if (cfg.needsHitl) return p.intent;
  }
  return null;
}

export interface BuildCompoundInput {
  signalId: string;
  organizationId: string;
  partials: PartialResponse[];
  expectedTasks: number;
  body: string;
  precedence: SpecialistId | null;
}

/**
 * Bouwt het compound ReviewItem uit een set partials + de door de Sonnet-
 * aggregator geproduceerde body. Confidence conservatief afgeleid uit de
 * partials; grounding samengevoegd; per-taak samenvatting voor cockpit-
 * drilldown.
 */
export function buildCompoundReviewItem(input: BuildCompoundInput): ReviewItem {
  const { partials, expectedTasks, precedence, body, signalId, organizationId } = input;
  const missing = expectedTasks - partials.length;
  const summary =
    `Compound antwoord — ${partials.length}/${expectedTasks} deel-antwoorden` +
    (missing > 0 ? ` (${missing} niet ontvangen)` : '') +
    (precedence ? ` — toon: ${getIntentConfig(precedence).displayName}` : '');

  const tasks: CompoundTaskSummary[] = partials.map((p) => ({
    taskId: p.taskId,
    intent: p.intent,
    status: p.status,
    confidence: p.confidence,
    summary: getIntentConfig(p.intent).displayName,
    reason: p.reason ?? null,
  }));

  // Conservatieve confidence: minimum over alle partials, plus een cap op
  // 0.3 zolang er partials ontbreken zodat de reviewer meteen ziet dat
  // handmatige controle nodig is. Geen partials → 0.
  const confidence =
    partials.length === 0
      ? 0
      : missing > 0
        ? Math.min(...partials.map((p) => p.confidence), 0.3)
        : Math.min(...partials.map((p) => p.confidence));

  const grounding: GroundingRef[] = partials.flatMap((p) => p.grounding ?? []);

  return {
    id: `ri_${signalId}_compound`,
    organizationId,
    signalId,
    kind: 'draft_email',
    summary,
    proposed: { body, compound: true },
    confidence,
    grounding: grounding.length > 0 ? grounding : null,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    compound: true,
    tasks,
    precedenceIntent: precedence,
  };
}
