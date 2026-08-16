import { describe, it, expect } from 'vitest';
import {
  agentDataCategories,
  extractJson,
  parseClassification,
  parsePlan,
  pickModelForIntent,
} from './steps.js';
import {
  categoryToSpecialist,
  simpleReplyConfig,
  orderChangeConfig,
  technicalConfig,
  escalateConfig,
} from '@factumai/agent-core';
import type { Env } from './env.js';

describe('extractJson', () => {
  it('haalt JSON uit ```json-fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('haalt JSON uit ruwe tekst met omringende prletekst', () => {
    expect(extractJson('Hier is het: {"a":2} — klaar')).toEqual({ a: 2 });
  });
  it('gooit als er geen object is', () => {
    expect(() => extractJson('geen json')).toThrow();
  });
});

describe('parseClassification', () => {
  it('normaliseert een volledige respons + leidt specialist af uit categorie', () => {
    // Onbekende categorie "order_status" → mapping-fallback = escalate.
    const c = parseClassification(
      '{"category":"order_status","confidence":0.9,"needsRag":true,"extracted":{"orderNumber":"SO-42"}}',
    );
    expect(c).toEqual({
      category: 'order_status',
      confidence: 0.9,
      needsRag: true,
      escalate: false,
      extracted: { orderNumber: 'SO-42' },
      specialist: 'escalate',
      // Geen `outcome` in de respons → afgeleid uit de specialist. Escalate
      // betekent "router kon niet classificeren", en dat is `onbekend`:
      // doorvragen, geen ticket.
      outcome: 'onbekend',
    });
  });

  it('neemt de uitkomst over als de router die noemt', () => {
    const c = parseClassification(
      '{"category":"levertijd_status","outcome":"systeem","extracted":{"orderNumber":"DEMO-1001"}}',
    );
    expect(c.outcome).toBe('systeem');
  });

  it('negeert een onbekende uitkomst en valt terug op de afleiding', () => {
    const c = parseClassification('{"category":"klacht","outcome":"onzin"}');
    expect(c.outcome).toBe('taak');
  });

  it('mapt de categorieën uit de taxonomie naar de juiste specialist', () => {
    expect(parseClassification('{"category":"levertijd_status"}').specialist).toBe('simple_reply');
    expect(parseClassification('{"category":"retour_ruilen"}').specialist).toBe('order_change');
    expect(parseClassification('{"category":"klacht"}').specialist).toBe('complaint');
    expect(parseClassification('{"category":"technisch_probleem"}').specialist).toBe('technical');
    expect(parseClassification('{"category":"gdpr_verzoek"}').specialist).toBe('gdpr');
    expect(parseClassification('{"category":"overig"}').specialist).toBe('escalate');
  });

  it('respecteert een expliciete specialist uit de LLM (overrulet mapping)', () => {
    const c = parseClassification(
      '{"category":"overig","specialist":"order_change","confidence":0.7,"extracted":{}}',
    );
    expect(c.specialist).toBe('order_change');
  });

  it('negeert een onbekende specialist-waarde en valt terug op de mapping', () => {
    const c = parseClassification(
      '{"category":"levertijd_status","specialist":"nonexistent","confidence":0.7,"extracted":{}}',
    );
    expect(c.specialist).toBe('simple_reply');
  });

  it('herkent het escalate-signaal', () => {
    const c = parseClassification(
      '{"category":"klacht","confidence":0.8,"escalate":true,"extracted":{}}',
    );
    expect(c.escalate).toBe(true);
  });

  it('vult defaults bij ontbrekende velden', () => {
    const c = parseClassification('{"category":"x"}');
    expect(c.confidence).toBe(0.5);
    expect(c.needsRag).toBe(false);
    expect(c.extracted).toEqual({});
    // Onbekende categorie → veilige escalate-fallback.
    expect(c.specialist).toBe('escalate');
    // Compound niet aanwezig → niet gezet.
    expect(c.compound).toBeUndefined();
    expect(c.tasks).toBeUndefined();
  });

  it('parseert een compound-mail met tasks[]', () => {
    const c = parseClassification(
      JSON.stringify({
        category: 'overig',
        confidence: 0.8,
        compound: true,
        tasks: [
          { id: 't0', intent: 'order_change', subject: 'wijzig order A', refs: { order_hint: 'meest recente' } },
          { id: 't1', intent: 'simple_reply', subject: 'status order B', refs: { order_hint: 'eerdere' } },
          { id: 't2', intent: 'technical', subject: 'defect onderdeel C', refs: {} },
        ],
      }),
    );
    expect(c.compound).toBe(true);
    expect(c.tasks).toHaveLength(3);
    expect(c.tasks?.[0].intent).toBe('order_change');
    expect(c.tasks?.[1].intent).toBe('simple_reply');
    expect(c.tasks?.[2].intent).toBe('technical');
  });

  it('valt terug op single als compound=true maar tasks < 2', () => {
    const c = parseClassification(
      JSON.stringify({
        category: 'overig',
        compound: true,
        tasks: [{ id: 't0', intent: 'order_change', subject: 'x', refs: {} }],
      }),
    );
    expect(c.compound).toBeUndefined();
    expect(c.tasks).toBeUndefined();
  });

  it('normaliseert een onbekende task-intent via categoryToSpecialist', () => {
    const c = parseClassification(
      JSON.stringify({
        category: 'overig',
        compound: true,
        tasks: [
          { id: 't0', intent: 'nonsense_intent', category: 'technisch_probleem', subject: 'x', refs: {} },
          { id: 't1', intent: 'simple_reply', subject: 'y', refs: {} },
        ],
      }),
    );
    // 'nonsense_intent' onbekend → categoryToSpecialist('technisch_probleem') = 'technical'
    expect(c.tasks?.[0].intent).toBe('technical');
  });
});

describe('categoryToSpecialist', () => {
  it('mapt bekende categorieën', () => {
    expect(categoryToSpecialist('gdpr_verzoek')).toBe('gdpr');
    expect(categoryToSpecialist('technisch_probleem')).toBe('technical');
    expect(categoryToSpecialist('facturatie')).toBe('simple_reply');
  });
  it('valt terug op escalate voor onbekende categorieën', () => {
    expect(categoryToSpecialist('total_nonsense')).toBe('escalate');
  });
});

describe('pickModelForIntent', () => {
  const baseEnv = {
    MODEL_CLASSIFY: 'claude-haiku-4-5',
    MODEL_PLAN: 'claude-sonnet-4-6',
  } as unknown as Env;

  it('classify-tier → MODEL_CLASSIFY', () => {
    expect(pickModelForIntent(baseEnv, escalateConfig)).toBe('claude-haiku-4-5');
    // simple_reply is ook classify-tier
    expect(pickModelForIntent(baseEnv, simpleReplyConfig)).toBe('claude-haiku-4-5');
  });

  it('plan-tier → MODEL_PLAN', () => {
    expect(pickModelForIntent(baseEnv, orderChangeConfig)).toBe('claude-sonnet-4-6');
  });

  it('plan-heavy → MODEL_PLAN_HEAVY als gezet, anders fallback op MODEL_PLAN', () => {
    // Zonder MODEL_PLAN_HEAVY: technical valt terug op MODEL_PLAN
    expect(pickModelForIntent(baseEnv, technicalConfig)).toBe('claude-sonnet-4-6');
    // Met MODEL_PLAN_HEAVY: gebruikt die
    const opusEnv = { ...baseEnv, MODEL_PLAN_HEAVY: 'claude-opus-4-7' } as Env;
    expect(pickModelForIntent(opusEnv, technicalConfig)).toBe('claude-opus-4-7');
  });

  it('respecteert lege string als ongezet', () => {
    const emptyEnv = { ...baseEnv, MODEL_PLAN_HEAVY: '   ' } as Env;
    expect(pickModelForIntent(emptyEnv, technicalConfig)).toBe('claude-sonnet-4-6');
  });
});

describe('agentDataCategories', () => {
  const env = (value?: string) => ({ AGENT_DATA_CATEGORIES: value }) as Env;

  it('geeft operationeel + commercieel als de var niet gezet is', () => {
    // De agent moet een klant kunnen vertellen wat zijn order kostte. Zonder
    // deze standaard krijgt hij sinds de veldclassificatie alleen operationeel
    // terug en verdwijnen orderbedragen stilletjes uit zijn antwoorden.
    expect(agentDataCategories(env())).toEqual(['operationeel', 'commercieel']);
    expect(agentDataCategories(env('   '))).toEqual(['operationeel', 'commercieel']);
  });

  it('geeft de agent nooit financieel tenzij het er expliciet staat', () => {
    expect(agentDataCategories(env())).not.toContain('financieel');
    expect(agentDataCategories(env('operationeel'))).toEqual(['operationeel']);
  });

  it('leest een expliciete lijst, ongeacht volgorde en spaties', () => {
    expect(agentDataCategories(env('financieel , operationeel'))).toEqual([
      'operationeel',
      'financieel',
    ]);
  });

  it('gooit onbekende waarden weg in plaats van te gokken', () => {
    expect(agentDataCategories(env('operationeel,hr'))).toEqual(['operationeel']);
  });

  it('valt terug op de standaard als er niets bruikbaars overblijft', () => {
    // Een kapot ingevulde var mag de agent niet laten stilvallen op elke
    // feitenvraag; de standaard lekt niets wat de klant niet zelf al ziet.
    expect(agentDataCategories(env('hr,marketing'))).toEqual([
      'operationeel',
      'commercieel',
    ]);
  });
});

describe('parsePlan', () => {
  it('parset body + gevalideerde claims', () => {
    const p = parsePlan(
      '{"summary":"s","subject":"Re: order","body":"Pakket 3SABC onderweg","claims":[{"value":"3SABC","toolCallId":"erp.get_order_tracking"}]}',
    );
    expect(p.subject).toBe('Re: order');
    expect(p.body).toContain('3SABC');
    expect(p.claims).toEqual([{ value: '3SABC', toolCallId: 'erp.get_order_tracking' }]);
  });
  it('negeert kapotte claims-entries', () => {
    const p = parsePlan('{"body":"x","claims":[{"value":"3"},{"value":"5","toolCallId":"erp.get_order"}]}');
    expect(p.claims).toEqual([{ value: '5', toolCallId: 'erp.get_order' }]);
  });
});
