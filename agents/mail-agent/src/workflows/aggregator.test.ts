import { describe, expect, it } from 'vitest';
import { buildCompoundReviewItem, pickPrecedence } from './aggregator-helpers.js';
import { packById, type PartialResponse } from '@factumai/agent-core';

// De aggregator weeft binnen één module: de labels en de vorm van het compound
// ReviewItem komen uit dat pakket.
const pack = packById('klantenservice')!;

function partial(overrides: Partial<PartialResponse> = {}): PartialResponse {
  return {
    signalId: 'sig_1',
    taskId: 't0',
    intent: 'simple_reply',
    status: 'ok',
    resolvedRefs: {},
    facts: {},
    proposedContent: 'Deel-antwoord.',
    confidence: 0.9,
    grounding: [],
    createdAt: '2026-07-05T10:00:00Z',
    ...overrides,
  };
}

describe('pickPrecedence', () => {
  it('kiest het eerste needsHitl-intent (klacht > simple_reply)', () => {
    const p = pickPrecedence(pack, [
      partial({ intent: 'simple_reply' }),
      partial({ intent: 'complaint', taskId: 't1' }),
      partial({ intent: 'custom_intent', taskId: 't2' }),
    ]);
    expect(p).toBe('complaint');
  });

  it('geeft null bij enkel neutrale intents', () => {
    const p = pickPrecedence(pack, [
      partial({ intent: 'simple_reply' }),
      partial({ intent: 'simple_reply', taskId: 't1' }),
    ]);
    expect(p).toBeNull();
  });

  it('gdpr is ook needsHitl → wordt gepakt', () => {
    const p = pickPrecedence(pack, [
      partial({ intent: 'simple_reply' }),
      partial({ intent: 'gdpr', taskId: 't1' }),
    ]);
    expect(p).toBe('gdpr');
  });
});

describe('buildCompoundReviewItem', () => {
  it('produceert een compound ReviewItem met tasks[], precedence en gecombineerde grounding', () => {
    const partials: PartialResponse[] = [
      partial({
        taskId: 't0',
        intent: 'order_change',
        confidence: 0.87,
        proposedContent: 'Wijzigen kan tot morgen 12:00.',
        grounding: [{ claim: 'morgen 12:00', toolCallId: 'tc-1', tool: 'bc.get_order' }],
      }),
      partial({
        taskId: 't1',
        intent: 'simple_reply',
        confidence: 0.94,
        proposedContent: 'Order SO-B is bezorgd op 14-11.',
        grounding: [{ claim: 'SO-B', toolCallId: 'tc-2', tool: 'erp.get_order' }],
      }),
    ];

    const item = buildCompoundReviewItem({
      pack,
      signalId: 'sig_1',
      organizationId: 'org_sun',
      partials,
      expectedTasks: 2,
      body: 'Beste klant,\n\n...\n\nMet vriendelijke groet',
      precedence: null,
    });

    expect(item.compound).toBe(true);
    expect(item.tasks).toHaveLength(2);
    expect(item.tasks?.[0].intent).toBe('order_change');
    expect(item.tasks?.[1].intent).toBe('simple_reply');
    // Confidence = minimum van de partials → 0.87.
    expect(item.confidence).toBeCloseTo(0.87);
    // Grounding: samengevoegd.
    expect(item.grounding).toHaveLength(2);
    expect(item.status).toBe('PENDING');
    expect(item.precedenceIntent).toBeNull();
    expect(item.signalId).toBe('sig_1');
  });

  it('drukt confidence extra naar beneden bij ontbrekende partials', () => {
    const item = buildCompoundReviewItem({
      pack,
      signalId: 'sig_2',
      organizationId: 'org_sun',
      partials: [partial({ confidence: 0.9 })],
      expectedTasks: 3, // 2 ontbreken
      body: 'x',
      precedence: null,
    });
    expect(item.confidence).toBeLessThanOrEqual(0.3);
    expect(item.summary).toContain('1/3');
    expect(item.summary).toContain('2 niet ontvangen');
  });

  it('geeft confidence 0 als er geen partials binnenkwamen', () => {
    const item = buildCompoundReviewItem({
      pack,
      signalId: 'sig_3',
      organizationId: 'org_sun',
      partials: [],
      expectedTasks: 2,
      body: '',
      precedence: null,
    });
    expect(item.confidence).toBe(0);
  });

  it('propageert precedenceIntent naar de ReviewItem + summary', () => {
    const item = buildCompoundReviewItem({
      pack,
      signalId: 'sig_4',
      organizationId: 'org_sun',
      partials: [
        partial({ intent: 'complaint', confidence: 0.7 }),
        partial({ intent: 'simple_reply', taskId: 't1', confidence: 0.9 }),
      ],
      expectedTasks: 2,
      body: 'x',
      precedence: 'complaint',
    });
    expect(item.precedenceIntent).toBe('complaint');
    expect(item.summary.toLowerCase()).toContain('klacht');
  });
});
