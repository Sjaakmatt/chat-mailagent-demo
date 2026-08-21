/**
 * Het bewijs van fase 2: een signaal dat niet uit mail komt, loopt door de hele
 * lus tot een ReviewItem.
 *
 * Zonder tweede module. De klantenservice-automatisering `ticket_opvolging`
 * maakt een signaal uit de eigen database, en dat gaat door dezelfde poort,
 * router en specialist als een binnengekomen mail. Draait dit, dan is de lus
 * niet langer een mailagent met een generieke naam.
 *
 * De poort en de classificatie draaien met een `FakeLlmClient`, net als in de
 * golden set: wat hier getoetst wordt is de mechaniek eromheen, niet het
 * oordeel van het model.
 */

import { describe, expect, it } from 'vitest';
import {
  FakeLlmClient,
  evaluateDomainGate,
  orchestrate,
  packById,
  resolveModule,
  type LlmCompleteInput,
  type OrchestrationSteps,
  type Signal,
} from '@factumai/agent-core';
import { scheduleEnvelope } from '../hydrators/schedule.js';

const NU = new Date('2026-08-21T08:00:00.000Z');

const TICKET = {
  id: 'tic_pro_2608_0012',
  number: 'PRO-2608-0012',
  status: 'OPEN',
  category: 'retour_ruilen',
  summary: 'Retour van twee artikelen aangemeld',
  contact_email: 'j.dekker@example.com',
  order_reference: 'ORD-2411-0022',
  created_at: '2026-08-15T09:00:00.000Z',
};

/** De automatisering draaien zoals de cron dat zou doen. */
async function draftUitAutomatisering() {
  const automatisering = packById('klantenservice')!.triggers!.automations![0]!;
  const drafts = await automatisering.expand({
    organizationId: 'org_demo',
    now: NU,
    config: {},
    async query() {
      return [TICKET] as never[];
    },
  });
  return drafts[0]!;
}

/** Het signaal zoals de intake het op de bus zou zetten. */
function signaalVan(draft: Awaited<ReturnType<typeof draftUitAutomatisering>>): Signal {
  return {
    id: 'sig_opvolging_1',
    organizationId: 'org_demo',
    domain: draft.domain,
    type: draft.type,
    payload: draft.payload,
    status: 'NEW',
    idempotencyKey: `auto:ticket_opvolging:2026-08-21:${draft.key}`,
    receivedAt: NU.toISOString(),
  };
}

/**
 * Dezelfde stappen als de agent bouwt, met een vaste LLM. De poort is de échte
 * functie uit agent-core; alleen de bron van het antwoord is vervangen.
 */
function stappen(pack: NonNullable<ReturnType<typeof packById>>): OrchestrationSteps {
  const llm = new FakeLlmClient((input: LlmCompleteInput) => {
    const system = input.messages.find((m) => m.role === 'system')?.content ?? '';
    if (system.includes('"inDomain"')) {
      return JSON.stringify({ inDomain: true, reason: 'gaat over een order van deze shop' });
    }
    return JSON.stringify({
      category: 'retour_ruilen',
      confidence: 0.88,
      needsRag: false,
      extracted: { orderNumber: 'ORD-2411-0022' },
    });
  });

  return {
    async gate(signal) {
      const payload = signal.payload as { subject?: string; bodyText?: string };
      return evaluateDomainGate(
        { subject: payload.subject, body: payload.bodyText ?? '' },
        llm,
        pack.gate,
      );
    },
    async classify() {
      return {
        category: 'retour_ruilen',
        confidence: 0.88,
        needsRag: false,
        extracted: { orderNumber: 'ORD-2411-0022' },
        specialist: 'order_change' as const,
        outcome: 'taak' as const,
      };
    },
    async resolve() {
      return {};
    },
    async plan() {
      return {
        kind: 'draft_email' as const,
        summary: 'Opvolging ticket PRO-2608-0012',
        subject: 'Update over je retour',
        body: 'We zijn nog met je retour bezig en laten uiterlijk vrijdag weten hoe het staat.',
        claims: [],
      };
    },
  };
}

describe('een gepland signaal loopt door de hele lus', () => {
  it('wordt geclaimd door de klantenservice-module', async () => {
    const signaal = signaalVan(await draftUitAutomatisering());
    // Niet 'mail', en toch een module: dat is precies wat fase 2 mogelijk maakt.
    expect(signaal.domain).toBe('schedule');
    expect(resolveModule(signaal)?.descriptor.id).toBe('klantenservice');
  });

  it('leest als envelop zonder dat de kern van roosters weet', async () => {
    const draft = await draftUitAutomatisering();
    const envelop = scheduleEnvelope(signaalVan(draft));

    expect(envelop.subject).toBe('Opvolging ticket PRO-2608-0012');
    expect(envelop.body).toContain('PRO-2608-0012');
    expect(envelop.refs.ticketNumber).toBe('PRO-2608-0012');
    expect(envelop.refs.orderNumber).toBe('ORD-2411-0022');
  });

  it('levert een PENDING ReviewItem op met de juiste module', async () => {
    const draft = await draftUitAutomatisering();
    const signaal = signaalVan(draft);
    const pack = resolveModule(signaal)!;

    const { reviewItem } = await orchestrate(signaal, {
      pack,
      envelope: scheduleEnvelope(signaal),
      steps: stappen(pack),
    });

    expect(reviewItem.status).toBe('PENDING');
    expect(reviewItem.module).toBe('klantenservice');
    expect(reviewItem.kind).toBe('draft_email');
    expect(reviewItem.summary).toContain('PRO-2608-0012');
  });

  it('bewaart het bewijsstuk zoals de automatisering het aanleverde', async () => {
    const draft = await draftUitAutomatisering();
    const signaal = signaalVan(draft);
    const pack = resolveModule(signaal)!;

    const { reviewItem } = await orchestrate(signaal, {
      pack,
      envelope: scheduleEnvelope(signaal),
      steps: stappen(pack),
    });

    const proposed = reviewItem.proposed as { original?: Record<string, unknown> };
    // `original` is wat het domein aanleverde, niet onze lezing ervan.
    expect(proposed.original).toEqual(draft.payload);
  });

  it('stopt de run als de poort dichtgaat, ook bij een gepland signaal', async () => {
    const draft = await draftUitAutomatisering();
    const signaal = signaalVan(draft);
    const pack = resolveModule(signaal)!;
    const dicht = new FakeLlmClient(() =>
      JSON.stringify({ inDomain: false, reason: 'gaat hier niet over' }),
    );

    const { reviewItem, classification } = await orchestrate(signaal, {
      pack,
      envelope: scheduleEnvelope(signaal),
      steps: {
        ...stappen(pack),
        async gate(s) {
          const p = s.payload as { bodyText?: string };
          return evaluateDomainGate({ body: p.bodyText ?? '' }, dicht, pack.gate);
        },
      },
    });

    expect(classification.outOfDomain).toBeTruthy();
    expect(reviewItem.proposed.body).toBe(pack.gate.rejectionText);
  });
});
