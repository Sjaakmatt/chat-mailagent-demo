/**
 * De chat-hydrator.
 *
 * Geen `hydrate`: bij chat zit de inhoud al in de payload. De chat-DO stuurt
 * het bericht mee op de bus én rechtstreeks de beurt in, juist omdat er iemand
 * zit te wachten — er is niets meer op te halen.
 */

import {
  baseEnvelope,
  refsFrom,
  type DomainHydrator,
  type EnvelopeParticipant,
  type Signal,
  type SignalEnvelope,
} from '@factumai/agent-core';

/** De sleutels waarmee een chatbeurt aan zijn gesprek en ticket hangt. */
const CHAT_REFS = ['conversationId', 'sessionId', 'ticketNumber'] as const;

export const chatHydrator: DomainHydrator = {
  domain: 'chat',
  toEnvelope: chatEnvelope,
};

export function chatEnvelope(signal: Signal): SignalEnvelope {
  const payload = (signal.payload ?? {}) as Record<string, unknown>;
  const basis = baseEnvelope(signal);

  // Bij chat is de afzender wat de bezoeker zelf heeft opgegeven, en dat is
  // precies waarom het identificatiebeleid van klantenservice er bij dit kanaal
  // een ordernummer bij eist. De envelop oordeelt daar niet over; hij geeft
  // door wat er is.
  const participants: EnvelopeParticipant[] = [];
  if (typeof payload.from === 'string' && payload.from.trim()) {
    participants.push({ address: payload.from, role: 'afzender' });
  }

  return {
    ...basis,
    body: typeof payload.bodyText === 'string' ? payload.bodyText : '',
    participants,
    refs: refsFrom(payload, CHAT_REFS),
    // Chat kent geen bijlagen. Dat is geen omissie maar de veilige kant: typen
    // die beeldmateriaal eisen ontstaan hier dus niet.
    attachments: [],
    occurredAt:
      typeof payload.receivedDateTime === 'string'
        ? payload.receivedDateTime
        : basis.occurredAt,
  };
}
