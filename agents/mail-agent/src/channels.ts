/**
 * Kanaal-dispatch voor de uitvoerkant.
 *
 * `agent-core/channels` beschrijft wélke kanalen er zijn; dit bestand koppelt
 * er de concrete bezorgroutine aan. De Execute-Workflow roept alleen
 * `performReviewItemAction` aan en hoeft niets van kanalen te weten.
 *
 * Een chat-kanaal toevoegen:
 *   1. Registreer `CHAT_CHANNEL` in `agent-core/src/channels/index.ts`.
 *   2. Schrijf een `deliverChatReply(env, item)` (bv. via een chat-MCP).
 *   3. Zet 'm hieronder in `DELIVERY` op de `reviewItemKind` van dat kanaal.
 * De lus, de werkbak-goedkeuring en de guardrails blijven ongewijzigd.
 */

import { channelForKind, type ReviewItem } from '@factumai/agent-core';
import type { Env } from './env.js';
import { deliverMailReply } from './steps.js';
import { deliverChatReply } from './chat/delivery.js';

/** Eén bezorgroutine per ReviewItem-soort. */
type DeliveryFn = (env: Env, item: ReviewItem) => Promise<{ ref?: string }>;

const DELIVERY: Record<string, DeliveryFn> = {
  draft_email: deliverMailReply,
  draft_chat_reply: deliverChatReply,
};

/**
 * Voert de goedgekeurde actie uit op het kanaal waar het ReviewItem vandaan
 * komt. Een onbekende soort is een configuratiefout, geen runtime-verrassing:
 * we falen luid, zodat er nooit stilletjes niets gebeurt met een goedgekeurd
 * antwoord.
 */
export async function performReviewItemAction(
  env: Env,
  item: ReviewItem,
): Promise<{ ref?: string }> {
  const deliver = DELIVERY[item.kind];
  if (!deliver) {
    const known = Object.keys(DELIVERY).join(', ');
    throw new Error(
      `Geen bezorgroutine voor ReviewItem-soort '${item.kind}' ` +
        `(bekend: ${known}). Registreer het kanaal in agent-core/channels ` +
        `en voeg een DELIVERY-regel toe in agents/mail-agent/src/channels.ts.`,
    );
  }
  const channel = channelForKind(item.kind);
  console.log(`[execute] bezorgen via kanaal '${channel?.id ?? item.kind}'`, item.id);
  return deliver(env, item);
}
