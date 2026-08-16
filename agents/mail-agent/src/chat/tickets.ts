/**
 * Tickets aanmaken vanuit de agent.
 *
 * Alleen bij uitkomst `taak`. Niet bij `onbekend` — dan vraagt de agent door,
 * en dat is precies waarom de werkbak niet volloopt met gesprekken die geen
 * taak zijn (bouwbriefing §3).
 */

import {
  SupabaseClient,
  ServiceRoleCredentialStore,
  normalizeTicketPrefix,
  ticketPeriod,
  ticketReadiness,
  confirmationText,
  categoryLabel,
  CONFIRMATION,
  type TicketIdentity,
} from '@factumai/agent-core';
import type { Env } from '../env.js';

export interface CreateTicketInput {
  organizationId: string;
  conversationId?: string | null;
  reviewItemId?: string | null;
  category?: string | null;
  summary: string;
  identity: TicketIdentity;
  /**
   * Waarom deze categorie langs een mens gaat, in één zin, uit de beleidsregel
   * die matchte. Gaat letterlijk de bevestiging in. Leeg = de generieke zin uit
   * `CONFIRMATION`.
   */
  handoverReason?: string | null;
}

export interface CreatedTicket {
  id: string;
  number: string;
  /** De tekst die de klant krijgt. Vaste opzet, nummer ingevuld. */
  confirmation: string;
}

/**
 * Maakt een ticket en geeft de bevestigingstekst terug.
 *
 * Geeft `null` als er te weinig identificatie is — dan hoort de agent door te
 * vragen in plaats van een ticket te maken waar niemand op kan terugkomen.
 *
 * Het nummer komt uit de database-RPC en niet uit deze code: twee gelijktijdige
 * runs zouden anders hetzelfde nummer uitgeven.
 */
export async function createTicket(
  env: Env,
  input: CreateTicketInput,
): Promise<CreatedTicket | null> {
  const readiness = ticketReadiness(input.identity);
  if (readiness.state === 'insufficient') return null;

  const db = new SupabaseClient(
    new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
    { projectUrl: env.AIOS_SUPABASE_URL },
  );
  const ctx = {
    organizationId: env.AIOS_ORG_ID,
    agentId: 'aios-agent',
    toolCallId: 'aios-agent',
  };

  const prefix = normalizeTicketPrefix(env.TICKET_PREFIX);
  const period = ticketPeriod(new Date());

  const numbers = await db.request<string[] | string>(ctx, db.rpcUrl('aios_next_ticket_number'), {
    method: 'POST',
    body: JSON.stringify({ p_org: input.organizationId, p_prefix: prefix, p_period: period }),
  });
  const number = Array.isArray(numbers) ? numbers[0] : numbers;
  if (typeof number !== 'string' || !number) {
    throw new Error('aios_next_ticket_number gaf geen nummer terug');
  }

  const id = `tic_${number.toLowerCase().replace(/-/g, '_')}`;
  await db.request<unknown>(ctx, db.tableUrl('aios_tickets'), {
    method: 'POST',
    body: JSON.stringify({
      id,
      organization_id: input.organizationId,
      number,
      conversation_id: input.conversationId ?? null,
      review_item_id: input.reviewItemId ?? null,
      status: 'OPEN',
      category: input.category ?? null,
      summary: input.summary,
      contact_email: readiness.state === 'complete' ? readiness.contactEmail : readiness.contactEmail,
      order_reference: readiness.state === 'complete' ? readiness.orderReference : null,
    }),
    prefer: 'return=minimal,resolution=merge-duplicates',
  });

  // Even benoemen waar het over ging, vóór de vaste bevestiging. Dat komt uit
  // gegevens die we al hebben — het categorielabel en het ordernummer — en niet
  // uit een model, dus er kan geen belofte in sluipen. Zonder deze regel leest
  // de bevestiging als een bonnetje: een nummer zonder onderwerp.
  const onderwerp = categoryLabel(input.category)?.toLowerCase();
  const order = readiness.state === 'complete' ? readiness.orderReference : null;
  const aanhef = onderwerp
    ? `Je vraag over ${onderwerp}${order ? ` bij ${order}` : ''} zet ik door.\n\n`
    : '';

  return {
    id,
    number,
    confirmation: aanhef + confirmationText(number, CONFIRMATION, input.handoverReason),
  };
}
