/**
 * De schedule-hydrator.
 *
 * Geen `hydrate`: een gepland signaal is al compleet als het op de bus komt.
 * De automatisering die 'm maakte heeft de feiten er zelf in gezet — uit de
 * database, niet uit een model — en dat is precies waarom een opvolgvoorstel
 * geen verzonnen bedragen kan bevatten.
 *
 * De vorm van de payload is die van elk ander signaal: een onderwerp, een
 * tekst, sleutels. Zo hoeft de lus niet te weten dat dit signaal uit een cron
 * kwam in plaats van uit een mailbox.
 */

import {
  baseEnvelope,
  type DomainHydrator,
  type Signal,
  type SignalEnvelope,
} from '@factumai/agent-core';

export const scheduleHydrator: DomainHydrator = {
  domain: 'schedule',
  toEnvelope: scheduleEnvelope,
};

export function scheduleEnvelope(signal: Signal): SignalEnvelope {
  const payload = (signal.payload ?? {}) as Record<string, unknown>;
  const basis = baseEnvelope(signal);

  // Alle string-sleutels uit `refs` overnemen, want welke dat zijn hangt af van
  // de automatisering: een ticket-opvolging verwijst naar een ticketnummer, een
  // openstaande-postenloop naar een factuurnummer. De expander weet dat, de
  // hydrator hoeft het niet te weten.
  const refsRaw =
    payload.refs && typeof payload.refs === 'object'
      ? (payload.refs as Record<string, unknown>)
      : {};
  const refs: Record<string, string> = {};
  for (const [k, v] of Object.entries(refsRaw)) {
    if (typeof v === 'string' && v.trim()) refs[k] = v;
  }

  return {
    ...basis,
    subject: typeof payload.subject === 'string' ? payload.subject : undefined,
    body: typeof payload.bodyText === 'string' ? payload.bodyText : '',
    // Geen afzender: hier vraagt niemand iets. Dat betekent dat het
    // identificatiebeleid van de module bepaalt of er automatisch iets mag —
    // en bij een geplande taak is dat vrijwel nooit.
    participants: [],
    refs,
    attachments: [],
    occurredAt:
      typeof payload.occurredAt === 'string' ? payload.occurredAt : basis.occurredAt,
  };
}
