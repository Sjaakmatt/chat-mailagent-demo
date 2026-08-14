/**
 * Roundtrip-tests voor de canonieke Zod-schemas. Doel:
 *  - Valideren dat schema ↔ TS-type in sync zijn.
 *  - JSON-roundtrip (serialize → parse) blijft identiek.
 *  - Optionele velden (compound, tasks) breken bestaande single-intent
 *    ReviewItems niet.
 *  - Edge-cases die de router/aggregator gaan raken.
 */

import { describe, it, expect } from 'vitest';
import {
  AutomationSchema,
  CompoundMetadataSchema,
  GroundingRefSchema,
  IntentClassificationSchema,
  IntentFlagsSchema,
  MemoryEntrySchema,
  PartialResponseSchema,
  ReviewItemSchema,
  SignalSchema,
  TaskDescriptorSchema,
} from './schemas.js';
import type {
  IntentClassification,
  PartialResponse,
  ReviewItem,
  Signal,
  TaskDescriptor,
} from './index.js';

function roundtrip<T>(schema: { parse: (x: unknown) => T }, value: T): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

describe('SignalSchema', () => {
  it('accepteert een minimale mail.received Signal', () => {
    const signal: Signal = {
      id: 'sig_1',
      organizationId: 'org_sun',
      domain: 'mail',
      type: 'mail.received',
      payload: { messageId: 'AAMk...' },
      status: 'NEW',
      receivedAt: '2026-07-05T10:00:00Z',
    };
    expect(roundtrip(SignalSchema, signal)).toEqual(signal);
  });

  it('bewaart nullable velden bij roundtrip', () => {
    const signal: Signal = {
      id: 'sig_2',
      organizationId: 'org_sun',
      domain: 'mail',
      type: 'mail.received',
      payload: {},
      status: 'PROCESSING',
      contactId: null,
      dealId: null,
      projectId: null,
      idempotencyKey: 'org_sun|_|mail|msg123',
      receivedAt: '2026-07-05T10:00:00Z',
      processedAt: null,
    };
    expect(roundtrip(SignalSchema, signal)).toEqual(signal);
  });
});

describe('IntentClassificationSchema', () => {
  const baseFlags = {
    hasImage: false,
    urgent: false,
    juridicalLanguage: false,
    gdprSignals: false,
    complaintSignals: false,
    compound: false,
  };

  it('accepteert een single-intent classificatie met exact 1 task', () => {
    const cls: IntentClassification = {
      primary: 'simple_reply',
      confidence: 0.92,
      compound: false,
      tasks: [
        {
          id: 't0',
          intent: 'simple_reply',
          subject: 'status vraag order',
          refs: { order_hint: 'meest recente' },
        },
      ],
      flags: baseFlags,
      reasoning: 'Klant vraagt naar status van huidige bestelling.',
    };
    expect(roundtrip(IntentClassificationSchema, cls)).toEqual(cls);
  });

  it('accepteert een compound classificatie met 3 tasks van verschillende intents', () => {
    const cls: IntentClassification = {
      primary: 'order_change',
      confidence: 0.78,
      compound: true,
      tasks: [
        {
          id: 't0',
          intent: 'order_change',
          subject: 'wijzigen huidige order A',
          refs: { order_hint: 'meest recente' },
        },
        {
          id: 't1',
          intent: 'simple_reply',
          subject: 'status eerdere order B',
          refs: { order_hint: 'bestelling ~3 maanden geleden' },
        },
        {
          id: 't2',
          intent: 'custom_intent',
          subject: 'moertjes ontbreken uit order C',
          refs: { order_hint: 'set moertjes', product_hint: 'M8' },
        },
      ],
      flags: { ...baseFlags, compound: true, secondary: 'simple_reply' },
      reasoning: 'Drie deelvragen: wijziging, status en missende onderdelen.',
      lowConfidence: false,
      topCandidates: [
        { specialist: 'order_change', score: 0.78 },
        { specialist: 'simple_reply', score: 0.15 },
        { specialist: 'custom_intent', score: 0.07 },
      ],
    };
    expect(roundtrip(IntentClassificationSchema, cls)).toEqual(cls);
  });

  it('weigert een classificatie zonder tasks', () => {
    const bad = {
      primary: 'simple_reply',
      confidence: 0.5,
      compound: false,
      tasks: [],
      flags: baseFlags,
      reasoning: '',
    };
    expect(() => IntentClassificationSchema.parse(bad)).toThrow();
  });

  it('weigert confidence buiten [0,1]', () => {
    const bad = {
      primary: 'simple_reply',
      confidence: 1.5,
      compound: false,
      tasks: [
        {
          id: 't0',
          intent: 'simple_reply',
          subject: 'x',
          refs: {},
        },
      ],
      flags: baseFlags,
      reasoning: '',
    };
    expect(() => IntentClassificationSchema.parse(bad)).toThrow();
  });
});

describe('TaskDescriptorSchema', () => {
  it('accepteert null-waarden in refs (order_hint niet gevuld)', () => {
    const task: TaskDescriptor = {
      id: 't0',
      intent: 'complaint',
      subject: 'klacht over kwaliteit',
      refs: { order_hint: null, product_hint: null },
      flags: { language: 'nl', urgent: true },
    };
    expect(roundtrip(TaskDescriptorSchema, task)).toEqual(task);
  });
});

describe('PartialResponseSchema', () => {
  it('accepteert een ok-status met facts + grounding', () => {
    const partial: PartialResponse = {
      signalId: 'sig_1',
      taskId: 't1',
      intent: 'simple_reply',
      status: 'ok',
      resolvedRefs: { orderId: 'SO-2024-1287' },
      facts: {
        order_status: 'delivered_2024-11-14',
        tracking: '3S NLA 00123456789',
      },
      proposedContent:
        'Uw eerdere bestelling SO-2024-1287 is op 14 november afgeleverd.',
      confidence: 0.94,
      grounding: [
        {
          claim: '14 november',
          toolCallId: 'tc_bc_1',
          tool: 'bc.get_order',
        },
        {
          claim: '3S NLA 00123456789',
          toolCallId: 'tc_postnl_1',
          tool: 'postnl.get_tracking',
        },
      ],
      toolCalls: [
        {
          tool: 'bc.get_order',
          params: { orderId: 'SO-2024-1287' },
          result: { status: 'delivered' },
          ok: true,
          toolCallId: 'tc_bc_1',
        },
      ],
      createdAt: '2026-07-05T10:00:05Z',
    };
    expect(roundtrip(PartialResponseSchema, partial)).toEqual(partial);
  });

  it('accepteert needs_human-status met reason', () => {
    const partial: PartialResponse = {
      signalId: 'sig_1',
      taskId: 't2',
      intent: 'custom_intent',
      status: 'needs_human',
      resolvedRefs: {},
      facts: {},
      proposedContent: '',
      confidence: 0.2,
      grounding: [],
      reason: 'Order niet ondubbelzinnig geïdentificeerd (0 kandidaten in Woo).',
      createdAt: '2026-07-05T10:00:05Z',
    };
    expect(roundtrip(PartialResponseSchema, partial)).toEqual(partial);
  });
});

describe('ReviewItemSchema — backwards compatible', () => {
  it('accepteert een klassieke single-intent ReviewItem zonder compound-velden', () => {
    const item: ReviewItem = {
      id: 'rev_1',
      organizationId: 'org_sun',
      signalId: 'sig_1',
      kind: 'draft_email',
      summary: 'Antwoord op statusvraag',
      proposed: { subject: 'Re:', body: 'Uw order is verstuurd.' },
      confidence: 0.9,
      grounding: [],
      status: 'PENDING',
      createdAt: '2026-07-05T10:00:00Z',
    };
    expect(roundtrip(ReviewItemSchema, item)).toEqual(item);
  });

  it('accepteert een compound ReviewItem met 3 tasks', () => {
    const item: ReviewItem = {
      id: 'rev_2',
      organizationId: 'org_sun',
      signalId: 'sig_1',
      kind: 'draft_email',
      summary: '3-in-1: wijziging + status + moertjes',
      proposed: { subject: 'Re:', body: 'Samengesteld antwoord...' },
      confidence: 0.78,
      grounding: [],
      status: 'PENDING',
      createdAt: '2026-07-05T10:00:07Z',
      compound: true,
      tasks: [
        {
          taskId: 't0',
          intent: 'order_change',
          status: 'ok',
          confidence: 0.87,
          summary: 'Wijziging van huidige order akkoord',
        },
        {
          taskId: 't1',
          intent: 'simple_reply',
          status: 'ok',
          confidence: 0.94,
          summary: 'Status eerdere order geleverd',
        },
        {
          taskId: 't2',
          intent: 'custom_intent',
          status: 'needs_human',
          confidence: 0.2,
          summary: 'Moertjes niet ondubbelzinnig geïdentificeerd',
          reason: '0 kandidaten in Woo',
        },
      ],
      precedenceIntent: null,
    };
    expect(roundtrip(ReviewItemSchema, item)).toEqual(item);
  });
});

describe('CompoundMetadataSchema', () => {
  it('dwingt compound=true af als literal', () => {
    expect(() =>
      CompoundMetadataSchema.parse({ compound: false, tasks: [] })
    ).toThrow();
  });
});

describe('IntentFlagsSchema', () => {
  it('accepteert alle flags false en secondary weggelaten', () => {
    const flags = {
      hasImage: false,
      urgent: false,
      juridicalLanguage: false,
      gdprSignals: false,
      complaintSignals: false,
      compound: false,
    };
    expect(IntentFlagsSchema.parse(flags)).toEqual(flags);
  });
});

describe('GroundingRefSchema', () => {
  it('accepteert een minimale grounding-ref', () => {
    const ref = { claim: '€ 1.299', toolCallId: 'tc_1', tool: 'bc.get_order' };
    expect(GroundingRefSchema.parse(ref)).toEqual(ref);
  });
});

describe('MemoryEntry + Automation — smoke', () => {
  it('MemoryEntry roundtrip met feedback-label', () => {
    const mem = {
      id: 'mem_1',
      organizationId: 'org_sun',
      scope: 'PROCESS' as const,
      pinned: false,
      title: 'Feedback: goedgekeurde reply',
      body: 'Goede reply-vorm...',
      embedding: null,
      source: 'feedback',
      sourceRef: 'rev_1',
      contactId: null,
      dealId: null,
      projectId: null,
      createdAt: '2026-07-05T10:00:00Z',
      label: 'GOOD' as const,
      supersededDraft: null,
    };
    expect(roundtrip(MemoryEntrySchema, mem)).toEqual(mem);
  });

  it('Automation roundtrip', () => {
    const auto = {
      id: 'auto_1',
      organizationId: 'org_sun',
      name: 'mail.received → draft',
      trigger: 'mail.received',
      schedule: null,
      autonomy: 'REVIEW' as const,
      enabled: true,
      toolScope: ['mail.*', 'bc.*', 'woo.*'],
      config: null,
      createdAt: '2026-07-05T10:00:00Z',
    };
    expect(roundtrip(AutomationSchema, auto)).toEqual(auto);
  });
});
