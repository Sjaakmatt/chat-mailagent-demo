import { describe, it, expect } from 'vitest';
import {
  notableEvents,
  ranClean,
  toDecisionLogRow,
  fromDecisionLogRow,
  type DecisionLog,
} from './index.js';

function log(overrides: Partial<DecisionLog> = {}): DecisionLog {
  return {
    signalId: 'sig_1',
    organizationId: 'org-demo',
    channel: 'mail',
    inDomain: true,
    category: 'levertijd_status',
    specialist: 'simple_reply',
    outcome: { outcome: 'systeem', reason: 'geïdentificeerd én systeemantwoord aanwezig' },
    steps: [{ step: 'gate' }, { step: 'classify' }, { step: 'plan' }],
    sources: [{ id: 'db.order', tool: 'db.demo_orders', hit: true }],
    ungrounded: [],
    grounding: null,
    confidence: 0.92,
    createdAt: '2026-08-17T10:00:00Z',
    ...overrides,
  };
}

describe('wat er opvalt aan een run', () => {
  it('een schone run levert niets op — en dat is zelf ook informatie', () => {
    expect(notableEvents(log())).toEqual([]);
    expect(ranClean(log())).toBe(true);
  });

  it('meldt een degradatie met beide uitkomsten erin', () => {
    const events = notableEvents(
      log({
        outcome: {
          outcome: 'taak',
          degradedFrom: 'systeem',
          reason: 'geen systeemantwoord uit de bron — niet gokken',
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('van systeem naar taak');
    expect(events[0]).toContain('niet gokken');
  });

  it('meldt een bron die niets opleverde', () => {
    const events = notableEvents(
      log({ sources: [{ id: 'erp.1', tool: 'erp.get_order', hit: false }] }),
    );
    expect(events.some((e) => e.includes('erp.get_order'))).toBe(true);
  });

  it('meldt niet-herleidbare claims', () => {
    const events = notableEvents(log({ ungrounded: ['3-5 werkdagen'] }));
    expect(events.some((e) => e.includes('3-5 werkdagen'))).toBe(true);
  });

  it('meldt lage zekerheid', () => {
    expect(notableEvents(log({ confidence: 0.42 })).some((e) => e.includes('0.42'))).toBe(true);
    expect(notableEvents(log({ confidence: 0.7 })).some((e) => e.includes('zekerheid'))).toBe(false);
  });

  // Bij een dichtgeslagen poort is er verder niets gebeurd. Dan ook niet
  // suggereren dat er bronnen zijn geraadpleegd of claims zijn afgekeurd.
  it('toont bij buiten-domein alleen dat, en verder niets', () => {
    const events = notableEvents(
      log({
        inDomain: false,
        domainReason: 'algemene kennisvraag',
        outcome: null,
        sources: [{ id: 'x', tool: 'erp.get_order', hit: false }],
        ungrounded: ['42'],
        confidence: 0.1,
      }),
    );
    expect(events).toEqual(['Buiten domein — algemene kennisvraag']);
  });

  it('stapelt meerdere bijzonderheden', () => {
    const events = notableEvents(
      log({
        outcome: { outcome: 'taak', degradedFrom: 'systeem', reason: 'geen identificatie' },
        sources: [{ id: 'a', tool: 'erp.get_order', hit: false }],
        ungrounded: ['morgen'],
        confidence: 0.3,
      }),
    );
    expect(events).toHaveLength(4);
    expect(ranClean(log({ ungrounded: ['x'] }))).toBe(false);
  });
});

describe('opslag heen en terug', () => {
  it('overleeft een rondje door de rij-vorm', () => {
    const origineel = log({ reviewItemId: 'ri_9', domainReason: 'over de shop' });
    const terug = fromDecisionLogRow(toDecisionLogRow(origineel, 'dl_1'));
    expect(terug).toEqual(origineel);
  });

  it('vult lege lijsten aan als de DB null teruggeeft', () => {
    const row = toDecisionLogRow(log(), 'dl_2');
    // PostgREST kan jsonb-kolommen als null teruggeven.
    const kapot = { ...row, steps: null, sources: null, ungrounded: null } as never;
    const terug = fromDecisionLogRow(kapot);
    expect(terug.steps).toEqual([]);
    expect(terug.sources).toEqual([]);
    expect(terug.ungrounded).toEqual([]);
  });
});
