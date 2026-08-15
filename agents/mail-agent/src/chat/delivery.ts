/**
 * Bezorging op het chat-kanaal.
 *
 * Anders dan bij mail is er geen externe dienst die het bericht aflevert: de
 * sessie leeft in een Durable Object en de bezoeker hangt aan een websocket.
 * "Bezorgen" is hier dus **het bericht in het gesprek schrijven**; de sessie-DO
 * duwt het naar de bezoeker en houdt de volgorde vast.
 *
 * Dat is bewust zo gesplitst: de Execute-Workflow is idempotent en mag opnieuw
 * draaien, en een dubbele websocket-push zou dan een dubbel bericht opleveren.
 * Een rij met een stabiele sleutel niet.
 */

import { SupabaseClient, ServiceRoleCredentialStore, type ReviewItem } from '@factumai/agent-core';
import type { Env } from '../env.js';

function client(env: Env): SupabaseClient {
  return new SupabaseClient(
    new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
    { projectUrl: env.AIOS_SUPABASE_URL },
  );
}

const CTX = (env: Env) => ({
  organizationId: env.AIOS_ORG_ID,
  agentId: 'aios-agent',
  toolCallId: 'aios-agent',
});

/**
 * Schrijft het goedgekeurde antwoord als uitgaand bericht in het gesprek.
 *
 * Idempotent op `msg-out-<reviewItemId>`: draait de Execute-step opnieuw, dan
 * overschrijft 'ie z'n eigen rij in plaats van een tweede bericht toe te voegen.
 */
export async function deliverChatReply(
  env: Env,
  item: ReviewItem,
): Promise<{ ref?: string }> {
  const proposed = item.proposed as {
    body?: string;
    conversationId?: string;
    resolved?: { enrichment?: { conversationId?: string } };
  };

  const conversationId =
    proposed.conversationId ?? proposed.resolved?.enrichment?.conversationId;

  if (!conversationId) {
    throw new Error(
      `ReviewItem ${item.id} heeft geen conversationId — kan het chatantwoord niet plaatsen`,
    );
  }

  const body = (proposed.body ?? '').trim();
  if (!body) {
    throw new Error(`ReviewItem ${item.id} heeft een lege body — niets te versturen`);
  }

  const db = client(env);
  const id = `msg-out-${item.id}`;

  await db.request<unknown>(CTX(env), db.tableUrl('aios_messages'), {
    method: 'POST',
    body: JSON.stringify({
      id,
      organization_id: item.organizationId,
      conversation_id: conversationId,
      direction: 'outbound',
      body,
      author: 'agent',
      signal_id: item.signalId ?? null,
    }),
    prefer: 'return=minimal,resolution=merge-duplicates',
  });

  // Het gesprek bijwerken zodat de werkbak en de sessie-DO de nieuwe stand zien.
  const convUrl = db.tableUrl('aios_conversations');
  convUrl.searchParams.set('id', `eq.${conversationId}`);
  await db.request<unknown>(CTX(env), convUrl, {
    method: 'PATCH',
    body: JSON.stringify({ last_message_at: new Date().toISOString() }),
    prefer: 'return=minimal',
  });

  // En naar de bezoeker duwen. Best-effort: de sessie kan al gesloten zijn
  // (venster dicht), en dan is het bericht nog steeds bewaard — de bezoeker
  // ziet het bij een volgende sessie of krijgt het per mail. Een gesloten
  // sessie mag de afhandeling niet laten falen.
  try {
    const sessionId = conversationId.replace(/^conv_chat_/, '');
    const stub = env.CHAT_SESSION.get(env.CHAT_SESSION.idFromName(sessionId));
    await stub.fetch('https://chat.internal/push', {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  } catch (err) {
    console.warn(
      '[chat] duwen naar de sessie mislukt (bericht is wel bewaard):',
      err instanceof Error ? err.message : String(err),
    );
  }

  return { ref: id };
}
