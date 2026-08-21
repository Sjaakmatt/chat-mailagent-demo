/**
 * Pure helpers voor de AggregatorWorkflow — géén Cloudflare-imports, zodat
 * ze in vitest getest kunnen worden zonder een `cloudflare:workers`-module
 * te hoeven mocken.
 */

import {
  getIntentConfig,
  type CompoundTaskSummary,
  type GroundingRef,
  type ModulePack,
  type PartialResponse,
  type ReviewItem,
  type SpecialistId,
} from '@factumai/agent-core';

/**
 * Het label van een specialist binnen dit pakket, met de ruwe id als terugval.
 *
 * Terugvallen en niet leeg laten: een partial van een specialist die deze
 * module niet (meer) kent, hoort zichtbaar te blijven in de samenvatting.
 */
function specialistLabel(pack: ModulePack, intent: SpecialistId): string {
  return getIntentConfig(pack.specialists, intent)?.displayName ?? intent;
}

/**
 * Kiest de intent die de toon van de samengestelde mail bepaalt. Regel:
 * eerste `needsHitl`-intent uit de partials wint; anders `null` (aggregator
 * neemt neutrale toon).
 */
export function pickPrecedence(
  pack: ModulePack,
  partials: PartialResponse[],
): SpecialistId | null {
  for (const p of partials) {
    if (getIntentConfig(pack.specialists, p.intent)?.needsHitl) return p.intent;
  }
  return null;
}

export interface BuildCompoundInput {
  /** Het pakket dat dit signaal behandelt — levert de labels en de vorm. */
  pack: ModulePack;
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
  const { pack, partials, expectedTasks, precedence, body, signalId, organizationId } =
    input;
  const missing = expectedTasks - partials.length;
  const summary =
    `Compound antwoord — ${partials.length}/${expectedTasks} deel-antwoorden` +
    (missing > 0 ? ` (${missing} niet ontvangen)` : '') +
    (precedence ? ` — toon: ${specialistLabel(pack, precedence)}` : '');

  const tasks: CompoundTaskSummary[] = partials.map((p) => ({
    taskId: p.taskId,
    intent: p.intent,
    status: p.status,
    confidence: p.confidence,
    summary: specialistLabel(pack, p.intent),
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
    module: pack.descriptor.id,
    kind: pack.review.defaultKind,
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
