/**
 * De mail-hydrator.
 *
 * De mail-MCP emit bewust alleen een `messageId`: de inhoud van een mailbox
 * hoort niet ongevraagd op een bus te staan. Deze hydrator haalt het bericht
 * op, plus best-effort de thread en de bijlagen, en leest het resultaat als
 * envelop.
 *
 * De domeincheck die hier vroeger stond (`signal.domain !== 'mail'`) is
 * verhuisd naar de registry: die kiest de hydrator, en dan hoeft een hydrator
 * niet meer te controleren of hij aan de beurt is.
 */

import {
  baseEnvelope,
  refsFrom,
  type DomainHydrator,
  type EnvelopeAttachment,
  type EnvelopeParticipant,
  type Signal,
  type SignalEnvelope,
} from '@factumai/agent-core';
import type { Env } from '../env.js';
import { hydrateMailSignal } from '../steps.js';

/** De velden die de mail-MCP als sleutel aanlevert. */
const MAIL_REFS = ['messageId', 'threadId', 'conversationId'] as const;

export function mailHydrator(env: Env): DomainHydrator {
  return {
    domain: 'mail',
    hydrate: (signal) => hydrateMailSignal(env, signal),
    toEnvelope: mailEnvelope,
  };
}

/**
 * Leest een gehydrateerd mail-signaal als envelop.
 *
 * Puur en defensief: een veld dat de mailbox niet gaf, wordt weggelaten in
 * plaats van geraden. Een lege `body` is een geldige uitkomst — dan heeft de
 * poort niets om op te oordelen, en dat hoort zichtbaar te zijn in plaats van
 * opgevuld.
 */
export function mailEnvelope(signal: Signal): SignalEnvelope {
  const payload = (signal.payload ?? {}) as Record<string, unknown>;
  const basis = baseEnvelope(signal);

  const participants: EnvelopeParticipant[] = [];
  if (typeof payload.from === 'string' && payload.from.trim()) {
    participants.push({ address: payload.from, role: 'afzender' });
  }

  return {
    ...basis,
    subject: typeof payload.subject === 'string' ? payload.subject : undefined,
    body: typeof payload.bodyText === 'string' ? payload.bodyText : '',
    participants,
    refs: refsFrom(payload, MAIL_REFS),
    attachments: Array.isArray(payload.attachments)
      ? (payload.attachments as EnvelopeAttachment[])
      : [],
    occurredAt:
      typeof payload.receivedDateTime === 'string'
        ? payload.receivedDateTime
        : basis.occurredAt,
  };
}
