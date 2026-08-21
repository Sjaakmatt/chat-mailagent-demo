/**
 * De document-hydrator.
 *
 * Een upload levert een verwijzing naar een bestand, geen tekst. Wat er in dat
 * bestand staat, hoort hier te worden opgehaald: OCR, veldherkenning, een
 * extractie-MCP. De uploadroute doet dat bewust niet — die neemt het bestand
 * aan en emit, en niets meer.
 *
 * Vandaag doet deze hydrator de extractie nog niet. Er is nog geen module die
 * documenten claimt (administratie is fase 5), en een extractie bouwen voor een
 * domein dat nog niemand leest is werk zonder afnemer. Wat er wél staat is de
 * naad: de envelop klopt, de verwijzing staat in `refs`, en het bestand hangt
 * als bijlage. Wie de extractie toevoegt, vult `hydrate` in en raakt de rest
 * van de lus niet aan.
 */

import {
  baseEnvelope,
  refsFrom,
  type DomainHydrator,
  type Signal,
  type SignalEnvelope,
} from '@factumai/agent-core';
import type { Env } from '../env.js';

/** De sleutels waarmee een upload terug te vinden is. */
const DOCUMENT_REFS = ['path', 'uploadId', 'invoiceNumber', 'orderNumber'] as const;

export function documentHydrator(_env: Env): DomainHydrator {
  return {
    domain: 'document',
    toEnvelope: documentEnvelope,
  };
}

export function documentEnvelope(signal: Signal): SignalEnvelope {
  const payload = (signal.payload ?? {}) as Record<string, unknown>;
  const basis = baseEnvelope(signal);

  const naam = typeof payload.filename === 'string' ? payload.filename : 'document';
  const pad = typeof payload.path === 'string' ? payload.path : null;

  return {
    ...basis,
    subject: naam,
    // Tot de extractie er is, is de bestandsnaam alles wat er te lezen valt.
    // Geen verzonnen inhoud: wat er niet is, staat er niet.
    body: typeof payload.text === 'string' ? payload.text : '',
    participants:
      typeof payload.uploadedBy === 'string' && payload.uploadedBy.trim()
        ? [{ address: payload.uploadedBy, role: 'afzender' }]
        : [],
    refs: refsFrom(payload, DOCUMENT_REFS),
    attachments: [
      {
        name: naam,
        contentType:
          typeof payload.contentType === 'string' ? payload.contentType : undefined,
        size: typeof payload.size === 'number' ? payload.size : undefined,
        path: pad,
        ...(pad ? {} : { note: 'geen pad in de payload' }),
      },
    ],
    occurredAt:
      typeof payload.uploadedAt === 'string' ? payload.uploadedAt : basis.occurredAt,
  };
}
