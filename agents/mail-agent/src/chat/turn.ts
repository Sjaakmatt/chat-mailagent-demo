/**
 * Wat de bezoeker terugkrijgt na één chatbeurt.
 *
 * Bij mail eindigt de lus bij een concept in de werkbak. Bij chat zit er iemand
 * te wachten, dus moet er nú iets terug. Wát er teruggaat, hangt af van de
 * uitkomst — en dat is precies de plek waar de autonomie-keuze uit
 * `docs/CHANNELS.md` wordt afgedwongen:
 *
 *   buiten domein  vaste afwijzingstekst; de lus is al gestopt
 *   kennis         het opgestelde antwoord, direct
 *   systeem        het opgestelde antwoord, direct
 *   taak           ticket + bevestigingstekst; het antwoord zelf gaat níet uit
 *   onbekend       de wedervraag die de agent opstelde; géén ticket
 *
 * `taak` en `onbekend` gaan nooit ongezien naar buiten met een inhoudelijk
 * antwoord. Dat is geen detail: het is wat voorkomt dat de agent iets belooft
 * wat een mens moet waarmaken.
 */

import {
  mayRespondWithoutHuman,
  routingFor,
  CONFIRMATION,
  identityPrompt,
  DOMAIN,
  type OutcomeDecision,
  type ReviewItem,
} from '@factumai/agent-core';
import type { Env } from '../env.js';
import { deliverChatReply } from './delivery.js';
import { createTicket } from './tickets.js';

export interface ChatTurnResult {
  /** Wat de bezoeker te zien kreeg. */
  reply: string;
  /** Nummer van het aangemaakte ticket, als er een kwam. */
  ticketNumber?: string;
  /** Voor het beslislog: waarom dit antwoord. */
  reason: string;
}

/**
 * Rondt één chatbeurt af. Geeft `null` terug als er niets te sturen valt
 * (lege body) — dan blijft het ReviewItem in de werkbak staan als vangnet.
 */
export async function finishChatTurn(
  env: Env,
  item: ReviewItem,
  outcome: OutcomeDecision | undefined,
  opts: { outOfDomain?: boolean; conversationId: string; category?: string | null },
): Promise<ChatTurnResult | null> {
  const proposed = item.proposed as {
    body?: string;
    original?: Record<string, unknown>;
    classification?: unknown;
    policy?: { handoverReason?: string };
  };
  const drafted = (proposed.body ?? '').trim();

  const push = async (text: string): Promise<void> => {
    await deliverChatReply(env, {
      ...item,
      proposed: { ...item.proposed, body: text, conversationId: opts.conversationId },
    });
  };

  // Buiten het domein: de vaste tekst staat al als body op het item, want de
  // lus is daar gestopt. Niets van de bezoeker komt hierin terug.
  if (opts.outOfDomain) {
    const text = drafted || DOMAIN.rejectionText;
    await push(text);
    return { reply: text, reason: 'buiten domein — vaste afwijzingstekst' };
  }

  const decided = outcome?.outcome ?? 'taak';

  // Taak: een mens moet iets uitzoeken. De bezoeker krijgt een bevestiging met
  // een ticketnummer, niet het opgestelde antwoord — dat is voor de medewerker.
  if (routingFor(decided).createsTicket) {
    const original = (proposed.original ?? {}) as Record<string, unknown>;
    const contactEmail = typeof original.from === 'string' ? original.from : null;

    // Het ordernummer komt uit de classificatie, niet uit de payload — daar
    // staat het niet in. De classifier haalt het uit het bericht óf uit het
    // gesprek ervoor, precies zoals `orchestrate` het ook gebruikt om te
    // bepalen of de bezoeker geïdentificeerd is. Hier iets anders lezen
    // betekende dat een gegeven ordernummer nooit meetelde, en de bezoeker de
    // vraag eindeloos terugkreeg.
    const geclassificeerd = (proposed.classification ?? {}) as {
      extracted?: Record<string, unknown>;
    };
    const uitClassificatie = geclassificeerd.extracted?.orderNumber;
    const orderReference =
      typeof uitClassificatie === 'string' && uitClassificatie.trim()
        ? uitClassificatie
        : typeof original.orderNumber === 'string'
          ? original.orderNumber
          : null;

    // De regel die `plan` toepaste, zoals die op het ReviewItem is gezet. Staat
    // onder `proposed` en niet op het item zelf — dat is de plek waar de
    // orchestrator 'm neerlegt.
    const toegepastBeleid = (proposed.policy ?? {}) as { handoverReason?: string };

    const ticket = await createTicket(env, {
      organizationId: item.organizationId,
      conversationId: opts.conversationId,
      reviewItemId: item.id,
      category: opts.category ?? null,
      summary: item.summary,
      identity: { contactEmail, orderReference },
      // Uit de beleidsregel die op deze categorie matchte — zie steps.ts. Zo
      // legt de bevestiging uit wélke afspraak hier geldt, in plaats van de
      // bezoeker af te schepen met "een collega kijkt ernaar".
      handoverReason: toegepastBeleid.handoverReason ?? null,
    });

    // Geen ticket = te weinig identificatie. Dan vragen we erom in plaats van
    // een ticket te maken waar niemand op kan terugkomen.
    if (!ticket) {
      // Vraag alleen naar wat er nog ontbreekt. Wie net zijn ordernummer gaf en
      // dezelfde vraag terugkrijgt, denkt dat de chat kapot is.
      const vraag = identityPrompt({ email: contactEmail, order: orderReference });
      await push(vraag);
      return {
        reply: vraag,
        reason: 'taak zonder volledige identificatie — om het ontbrekende gevraagd',
      };
    }

    await push(ticket.confirmation);
    return {
      reply: ticket.confirmation,
      ticketNumber: ticket.number,
      reason: `taak — ticket ${ticket.number} aangemaakt`,
    };
  }

  // Onbekend: doorvragen. De agent heeft daar een wedervraag voor opgesteld.
  if (routingFor(decided).asksFollowUp) {
    if (!drafted) return null;
    await push(drafted);
    return { reply: drafted, reason: 'onbekend — doorgevraagd, geen ticket' };
  }

  // Kennis en systeem: direct naar de bezoeker. Dit is het enige pad waar een
  // inhoudelijk antwoord zonder mens naar buiten gaat.
  if (mayRespondWithoutHuman('chat', decided)) {
    if (!drafted) return null;
    await push(drafted);
    return { reply: drafted, reason: `${decided} — direct beantwoord` };
  }

  return null;
}
