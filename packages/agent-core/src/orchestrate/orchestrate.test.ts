import { describe, it, expect } from 'vitest';
import {
  orchestrate,
  runRoute,
  runSpecialize,
  type OrchestrationSteps,
} from './index.js';
import type { Signal } from '../contracts/index.js';

const signal: Signal = {
  id: 'sig-1',
  organizationId: 'org-demo',
  domain: 'mail',
  type: 'mail.received',
  payload: { from: 'klant@example.com', subject: 'Waar blijft mijn order?' },
  status: 'NEW',
  receivedAt: '2026-06-23T10:00:00.000Z',
};

function steps(overrides: Partial<OrchestrationSteps> = {}): OrchestrationSteps {
  return {
    classify: async () => ({
      category: 'order_status',
      confidence: 0.9,
      needsRag: false,
      extracted: { orderNumber: 'SO-42' },
    }),
    resolve: async () => ({ contactId: 'c-1' }),
    plan: async ({ recorder }) => {
      recorder.record({ toolCallId: 'tc-track', tool: 'erp.get_order_tracking' });
      return {
        kind: 'draft_email',
        summary: 'Antwoord op order-status vraag',
        subject: 'Re: Waar blijft mijn order?',
        body: 'Je pakket met code 3SABC123 is onderweg.',
        claims: [{ value: '3SABC123', toolCallId: 'tc-track' }],
      };
    },
    ...overrides,
  };
}

describe('orchestrate', () => {
  it('produceert altijd een ReviewItem(PENDING) — nooit een side effect', async () => {
    const res = await orchestrate(signal, {
      steps: steps(),
      now: () => '2026-06-23T10:00:01.000Z',
      newId: () => 'ri-1',
    });

    expect(res.reviewItem.status).toBe('PENDING');
    expect(res.reviewItem.kind).toBe('draft_email');
    expect(res.reviewItem.signalId).toBe('sig-1');
    expect(res.reviewItem.organizationId).toBe('org-demo');
    expect(res.reviewItem.proposed.subject).toBe('Re: Waar blijft mijn order?');
  });

  it('koppelt grounding-refs en houdt het vertrouwen hoog bij gegronde claims', async () => {
    const res = await orchestrate(signal, { steps: steps() });
    expect(res.ungrounded).toEqual([]);
    expect(res.reviewItem.grounding).toEqual([
      { claim: '3SABC123', toolCallId: 'tc-track', tool: 'erp.get_order_tracking' },
    ]);
    expect(res.reviewItem.confidence).toBeCloseTo(0.9);
  });

  it('verlaagt vertrouwen + zet guardrail-vlag bij niet-gegronde getallen', async () => {
    const res = await orchestrate(signal, {
      steps: steps({
        plan: async () => ({
          kind: 'draft_email',
          summary: 'x',
          body: 'Er liggen 7 panelen klaar, prijs 500 euro.',
          claims: [],
        }),
      }),
    });
    expect(res.ungrounded.length).toBeGreaterThan(0);
    expect((res.reviewItem.proposed.guardrail as { ungroundedClaims: string[] }).ungroundedClaims)
      .toEqual(expect.arrayContaining(['7', '500']));
    expect(res.reviewItem.confidence!).toBeLessThan(0.9);
  });

  it('slaat retrieve over als needsRag false is', async () => {
    let retrieveCalled = false;
    await orchestrate(signal, {
      steps: steps({
        retrieve: async () => {
          retrieveCalled = true;
          return [];
        },
      }),
    });
    expect(retrieveCalled).toBe(false);
  });

  it('roept retrieve aan als needsRag true is', async () => {
    let retrieveCalled = false;
    await orchestrate(signal, {
      steps: steps({
        classify: async () => ({
          category: 'order_status',
          confidence: 0.8,
          needsRag: true,
          extracted: {},
        }),
        retrieve: async () => {
          retrieveCalled = true;
          return [];
        },
      }),
    });
    expect(retrieveCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fase 2 — runRoute / runSpecialize split (backwards-compat)
// ---------------------------------------------------------------------------

describe('runRoute + runSpecialize split', () => {
  it('runRoute levert alleen de Classification (roept resolve/plan NIET aan)', async () => {
    let planCalled = false;
    let resolveCalled = false;
    const cls = await runRoute(signal, {
      steps: steps({
        resolve: async () => {
          resolveCalled = true;
          return { contactId: 'c-1' };
        },
        plan: async () => {
          planCalled = true;
          return {
            kind: 'draft_email',
            summary: 's',
            body: '',
            claims: [],
          };
        },
      }),
    });
    expect(cls.category).toBe('order_status');
    expect(cls.confidence).toBe(0.9);
    expect(resolveCalled).toBe(false);
    expect(planCalled).toBe(false);
  });

  it('runSpecialize werkt met een gegeven Classification (roept classify NIET aan)', async () => {
    let classifyCalled = false;
    const givenClassification = {
      category: 'order_status',
      confidence: 0.9,
      needsRag: false,
      extracted: { orderNumber: 'SO-42' },
    };
    const res = await runSpecialize(signal, givenClassification, {
      steps: steps({
        classify: async () => {
          classifyCalled = true;
          return givenClassification;
        },
      }),
      now: () => '2026-06-23T10:00:01.000Z',
      newId: () => 'ri-2',
    });
    expect(classifyCalled).toBe(false);
    expect(res.reviewItem.id).toBe('ri-2');
    expect(res.reviewItem.status).toBe('PENDING');
    expect(res.classification).toBe(givenClassification);
  });

  it('orchestrate() === runRoute() ∘ runSpecialize() — identieke ReviewItem', async () => {
    const s = steps();
    const composedRes = await orchestrate(signal, {
      steps: s,
      now: () => '2026-06-23T10:00:01.000Z',
      newId: () => 'ri-same',
    });

    const s2 = steps();
    const cls = await runRoute(signal, { steps: s2 });
    const splitRes = await runSpecialize(signal, cls, {
      steps: s2,
      now: () => '2026-06-23T10:00:01.000Z',
      newId: () => 'ri-same',
    });

    // Roundtrip: dezelfde velden en hetzelfde proposed-object.
    expect(splitRes.reviewItem.id).toBe(composedRes.reviewItem.id);
    expect(splitRes.reviewItem.confidence).toBe(composedRes.reviewItem.confidence);
    expect(splitRes.reviewItem.proposed).toEqual(composedRes.reviewItem.proposed);
    expect(splitRes.reviewItem.grounding).toEqual(composedRes.reviewItem.grounding);
    expect(splitRes.ungrounded).toEqual(composedRes.ungrounded);
  });
});
