/**
 * Tests op de intent-registry (Fase 1 multi-agent):
 *  - Elke kern-config voldoet aan het Zod-schema.
 *  - IDs zijn uniek.
 *  - Lookup werkt voor bekende IDs; onbekend → escalate-fallback.
 *  - Orchestrator wire-up: classification.specialist → intentConfig komt in
 *    plan() aan; deriveTriage() respecteert needsHitl en confidenceThreshold.
 */

import { describe, expect, it } from 'vitest';
import {
  CORE_INTENTS,
  INTENT_REGISTRY,
  IntentConfigSchema,
  escalateConfig,
  getIntentConfig,
  knownSpecialistIds,
} from './index.js';
import { deriveTriage, orchestrate } from '../orchestrate/index.js';
import type {
  Classification,
  OrchestrationSteps,
  Plan,
} from '../orchestrate/index.js';
import type { Signal } from '../contracts/index.js';

describe('CORE_INTENTS', () => {
  it('voldoet elk aan het IntentConfig-schema', () => {
    for (const cfg of CORE_INTENTS) {
      expect(() => IntentConfigSchema.parse(cfg)).not.toThrow();
    }
  });

  it('heeft unieke IDs', () => {
    const ids = CORE_INTENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bevat de 5 kern-specialisten + escalate-fallback', () => {
    const ids = knownSpecialistIds();
    expect(ids).toEqual([
      'simple_reply',
      'order_change',
      'complaint',
      'technical',
      'gdpr',
      'escalate',
    ]);
  });

  it('markeert klacht en gdpr altijd als needsHitl', () => {
    expect(INTENT_REGISTRY.get('complaint')!.needsHitl).toBe(true);
    expect(INTENT_REGISTRY.get('gdpr')!.needsHitl).toBe(true);
  });

  it('markeert de technische intent als vision-vereist', () => {
    expect(INTENT_REGISTRY.get('technical')!.needsVision).toBe(true);
  });

  it('escalate heeft lege tool-scope + lege memory-scope', () => {
    expect(escalateConfig.toolScope).toEqual([]);
    expect(escalateConfig.memoryScope).toEqual([]);
  });
});

describe('getIntentConfig', () => {
  it('geeft de exacte config terug voor een bekende SpecialistId', () => {
    expect(getIntentConfig('simple_reply').id).toBe('simple_reply');
    expect(getIntentConfig('order_change').id).toBe('order_change');
  });

  it('valt terug op escalate bij een onbekende ID (geen throw)', () => {
    expect(getIntentConfig('nonexistent_intent').id).toBe('escalate');
    expect(getIntentConfig('' as string).id).toBe('escalate');
  });
});

// ---------------------------------------------------------------------------
// Orchestrator wire-up
// ---------------------------------------------------------------------------

function makeSignal(): Signal {
  return {
    id: 'sig_test',
    organizationId: 'org_demo',
    domain: 'mail',
    type: 'mail.received',
    payload: { messageId: 'msg-1' },
    status: 'NEW',
    receivedAt: '2026-07-05T10:00:00Z',
  };
}

function makeSteps(classification: Classification): {
  steps: OrchestrationSteps;
  planCalls: Parameters<OrchestrationSteps['plan']>[0][];
} {
  const planCalls: Parameters<OrchestrationSteps['plan']>[0][] = [];
  const steps: OrchestrationSteps = {
    async classify() {
      return classification;
    },
    async resolve() {
      return {};
    },
    async plan(input) {
      planCalls.push(input);
      const plan: Plan = {
        kind: 'draft_email',
        summary: 'test',
        body: 'Hallo, uw order is verstuurd.',
        claims: [],
      };
      return plan;
    },
  };
  return { steps, planCalls };
}

describe('orchestrate() — intentConfig doorgeven aan plan', () => {
  it('resolvet intentConfig uit specialist en geeft die door aan plan()', async () => {
    const { steps, planCalls } = makeSteps({
      category: 'status',
      confidence: 0.9,
      needsRag: false,
      extracted: {},
      specialist: 'simple_reply',
    });
    await orchestrate(makeSignal(), { steps });
    expect(planCalls).toHaveLength(1);
    expect(planCalls[0].intentConfig?.id).toBe('simple_reply');
  });

  it('geeft geen intentConfig door als classification.specialist ontbreekt (backwards-compat)', async () => {
    const { steps, planCalls } = makeSteps({
      category: 'status',
      confidence: 0.9,
      needsRag: false,
      extracted: {},
    });
    await orchestrate(makeSignal(), { steps });
    expect(planCalls[0].intentConfig).toBeUndefined();
  });

  it('valt terug op escalate bij een onbekende specialist-ID', async () => {
    const { steps, planCalls } = makeSteps({
      category: 'onbekend',
      confidence: 0.4,
      needsRag: false,
      extracted: {},
      specialist: 'weird_intent_that_does_not_exist',
    });
    await orchestrate(makeSignal(), { steps });
    expect(planCalls[0].intentConfig?.id).toBe('escalate');
  });

  it('zet specialist op proposed.classification van de ReviewItem', async () => {
    const { steps } = makeSteps({
      category: 'wijziging',
      confidence: 0.9,
      needsRag: false,
      extracted: {},
      specialist: 'order_change',
    });
    const { reviewItem } = await orchestrate(makeSignal(), { steps });
    expect(reviewItem.proposed.classification).toMatchObject({
      specialist: 'order_change',
    });
  });
});

// ---------------------------------------------------------------------------
// deriveTriage met intent-config
// ---------------------------------------------------------------------------

describe('deriveTriage() met intentConfig', () => {
  const highConfidenceClassification: Classification = {
    category: 'status',
    confidence: 0.95,
    needsRag: false,
    extracted: {},
  };

  it('escalate-specialist → tier=escalate', () => {
    const triage = deriveTriage(
      highConfidenceClassification,
      undefined,
      0,
      0.95,
      escalateConfig,
    );
    expect(triage.tier).toBe('escalate');
    expect(triage.reason).toMatch(/router kon niet classificeren/);
  });

  it('needsHitl (bv. complaint) → nooit simple, altijd minstens review', () => {
    const complaint = INTENT_REGISTRY.get('complaint')!;
    const triage = deriveTriage(
      highConfidenceClassification,
      undefined,
      0,
      0.99,
      complaint,
    );
    expect(triage.tier).toBe('review');
    expect(triage.reason).toContain('HITL');
  });

  it('adjustedConfidence onder intent-drempel → tier=review', () => {
    const orderChange = INTENT_REGISTRY.get('order_change')!;
    // order_change heeft threshold 0.85; simuleer 0.8
    const cls: Classification = {
      category: 'wijziging',
      confidence: 0.8,
      needsRag: false,
      extracted: {},
    };
    const triage = deriveTriage(cls, undefined, 0, 0.8, orderChange);
    expect(triage.tier).toBe('review');
    // needsHitl komt eerst — verifieer dat de reden past
    expect(triage.reason).toMatch(/HITL|intent-drempel/);
  });

  it('simple_reply met hoge confidence + geen ungrounded → tier=simple', () => {
    const simple = INTENT_REGISTRY.get('simple_reply')!;
    const triage = deriveTriage(
      highConfidenceClassification,
      undefined,
      0,
      0.9,
      simple,
    );
    expect(triage.tier).toBe('simple');
  });

  it('zonder intentConfig blijft het gedrag identiek aan de oude flow', () => {
    // Backwards-compat: classifiers zonder specialist zetten intentConfig niet
    // door; deriveTriage() valt dan terug op de generieke 0.7-drempel.
    const triage = deriveTriage(
      highConfidenceClassification,
      undefined,
      0,
      0.9,
      undefined,
    );
    expect(triage.tier).toBe('simple');

    const lowConfTriage = deriveTriage(
      highConfidenceClassification,
      undefined,
      0,
      0.5,
      undefined,
    );
    expect(lowConfTriage.tier).toBe('review');
  });
});
