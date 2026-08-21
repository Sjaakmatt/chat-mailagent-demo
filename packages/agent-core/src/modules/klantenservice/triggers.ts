/**
 * De eigen ingangen van klantenservice — waar dit proces begint zonder mail.
 *
 * Vandaag één: tickets die te lang openstaan. Dat is bewust het eerste, want
 * het is het geval waar een klant het meest aan heeft en het minst aan risico
 * kleeft: alle feiten komen uit onze eigen database, er komt geen model aan te
 * pas bij het vaststellen ervan, en de uitkomst is een concept dat een mens
 * goedkeurt zoals elk ander voorstel.
 */

import type { ModuleTriggers, SignalDraft, TriggerContext } from '../../triggers/index.js';

/** Hoe lang een ticket mag openstaan voordat het opvolging verdient. */
const STANDAARD_DAGEN = 3;

/** Hoeveel tickets één tik maximaal oppakt. */
const MAX_PER_TIK = 25;

/** De velden die we van een ticket nodig hebben om het op te volgen. */
interface OpenTicket {
  id: string;
  number: string;
  status: string;
  category: string | null;
  summary: string;
  contact_email: string | null;
  order_reference: string | null;
  created_at: string;
}

export const KLANTENSERVICE_TRIGGERS: ModuleTriggers = {
  automations: [
    {
      name: 'ticket_opvolging',
      description:
        'Pakt tickets op die langer dan N dagen open staan en stelt per ticket ' +
        'een opvolgbericht voor. N staat in `config.dagen` (standaard 3).',

      /**
       * Zoekt de tickets die te lang openstaan en maakt er één signaal per
       * ticket van.
       *
       * **Eén signaal per ticket, geen verzamelsignaal.** De hele lus rust op
       * "één signaal, één voorstel": een reviewer keurt per ticket goed, en een
       * verzamelbericht zou hem dwingen alles of niets te nemen.
       *
       * De tekst wordt hier samengesteld uit velden die we al hebben — nummer,
       * onderwerp, leeftijd. Geen model. Daardoor kan er geen bedrag of datum
       * in staan dat niemand kan navertellen, en dat is precies wat harde regel
       * 4 vraagt.
       */
      async expand(ctx: TriggerContext): Promise<SignalDraft[]> {
        const dagen = leesDagen(ctx.config);
        const grens = new Date(ctx.now.getTime() - dagen * 24 * 60 * 60 * 1000);

        const tickets = await ctx.query<OpenTicket>('aios_tickets', {
          status: 'in.(OPEN,IN_PROGRESS)',
          created_at: `lt.${grens.toISOString()}`,
          order: 'created_at.asc',
          limit: String(MAX_PER_TIK),
        });

        return tickets
          // Zonder mailadres is er geen terugkoppelkanaal, en dan is een
          // opvolgbericht een concept dat nergens heen kan.
          .filter((t) => Boolean(t.contact_email?.trim()))
          .map((ticket) => draftVoor(ticket, ctx.now, dagen));
      },
    },
  ],
};

/** `config.dagen`, met een ondergrens zodat een 0 geen dagelijkse ruis geeft. */
function leesDagen(config: Record<string, unknown>): number {
  const waarde = config.dagen;
  const dagen = typeof waarde === 'number' ? waarde : Number.parseInt(String(waarde), 10);
  if (!Number.isFinite(dagen) || dagen < 1) return STANDAARD_DAGEN;
  return Math.min(dagen, 365);
}

/**
 * Zet één ticket om in een signaal.
 *
 * De `refs` dragen het ticketnummer en het ordernummer, zodat de specialist
 * later weet waar dit over gaat zonder het uit de tekst te hoeven vissen.
 */
function draftVoor(ticket: OpenTicket, now: Date, drempel: number): SignalDraft {
  const dagenOpen = Math.floor(
    (now.getTime() - Date.parse(ticket.created_at)) / (24 * 60 * 60 * 1000),
  );

  const regels = [
    `Ticket ${ticket.number} staat ${dagenOpen} dagen open (drempel: ${drempel}).`,
    `Onderwerp: ${ticket.summary}`,
    ticket.order_reference ? `Order: ${ticket.order_reference}` : null,
    `Status: ${ticket.status}`,
    '',
    'Stel een bericht op waarin de klant een update krijgt over de stand van ' +
      'zaken. Beloof niets wat niet uit het ticket blijkt.',
  ].filter((r): r is string => r !== null);

  return {
    domain: 'schedule',
    // Wordt overschreven door de intake met `schedule.<naam>`; hier zodat het
    // type compleet is en een test 'm los kan gebruiken.
    type: 'schedule.ticket_opvolging',
    // Onderscheidt dit signaal van de andere uit dezelfde tik. Zonder deze
    // sleutel krijgen alle tickets van vandaag dezelfde idempotency-sleutel en
    // houdt de bus er één over.
    key: ticket.number,
    payload: {
      subject: `Opvolging ticket ${ticket.number}`,
      bodyText: regels.join('\n'),
      occurredAt: now.toISOString(),
      refs: {
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        ...(ticket.order_reference ? { orderNumber: ticket.order_reference } : {}),
      },
      // De klant aan wie het antwoord gericht is. De envelop leest dit als
      // afzender, zodat het identificatiebeleid van deze module er iets mee kan.
      from: ticket.contact_email,
      ticket: {
        number: ticket.number,
        status: ticket.status,
        category: ticket.category,
        summary: ticket.summary,
        createdAt: ticket.created_at,
        dagenOpen,
      },
    },
  };
}
