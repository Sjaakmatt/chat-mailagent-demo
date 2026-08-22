/**
 * De feitenlaag: wie wat krijgt, en wat er gebeurt als een bron zwijgt.
 */

import { describe, expect, it, vi } from 'vitest';
import { begrens, collectFacts, providersInScope, sourceLabel } from './index.js';
import { ToolCallRecorder } from '../grounding/index.js';
import type { FactProvider, ModulePack } from '../modules/contract.js';
import type { SignalEnvelope } from '../envelope/index.js';

const ENVELOP: SignalEnvelope = {
  subject: 'Waar blijft ORD-1?',
  body: 'Ik wacht nog op mijn bestelling.',
  participants: [{ address: 'k@example.com', role: 'afzender' }],
  refs: {},
  attachments: [],
  occurredAt: '2026-08-21T08:00:00.000Z',
  raw: {},
};

const ORDER: FactProvider = {
  name: 'order.get',
  description: 'De order bij het genoemde nummer.',
  source: { kind: 'table', table: 'demo_orders' },
  dataCategories: ['operationeel'],
  input: (ctx) =>
    typeof ctx.extracted.orderNumber === 'string'
      ? { orderNumber: ctx.extracted.orderNumber }
      : null,
  toFacts: (data) => [{ id: 'db.order', text: `Order: ${JSON.stringify(data)}` }],
};

const TRACKING: FactProvider = {
  name: 'order.tracking',
  description: 'De zending bij de code uit de order.',
  source: { kind: 'table', table: 'demo_order_tracking' },
  dataCategories: ['operationeel'],
  // Leunt op wat de order opleverde: dat is de reden dat bronnen op volgorde
  // draaien en niet tegelijk.
  input: (ctx) => {
    const order = ctx.results['order.get'] as { trackingCode?: string } | undefined;
    return order?.trackingCode ? { code: order.trackingCode } : null;
  },
  toFacts: (data) => [{ id: 'db.tracking', text: `Zending: ${JSON.stringify(data)}` }],
};

const FACTUUR: FactProvider = {
  name: 'invoice.get',
  description: 'De factuur bij de order.',
  source: { kind: 'table', table: 'demo_invoices' },
  dataCategories: ['financieel'],
  input: (ctx) =>
    typeof ctx.extracted.orderNumber === 'string'
      ? { orderNumber: ctx.extracted.orderNumber }
      : null,
  toFacts: (data) => (data ? [{ id: 'db.invoice', text: `Factuur: ${JSON.stringify(data)}` }] : []),
};

function pack(facts: FactProvider[] = [ORDER, TRACKING, FACTUUR]): ModulePack {
  return { facts } as unknown as ModulePack;
}

function opzet(
  opties: {
    facts?: FactProvider[];
    toolScope?: string[];
    extracted?: Record<string, unknown>;
    antwoord?: (naam: string) => { ok: boolean; data?: unknown; error?: string };
    allowed?: Array<'operationeel' | 'commercieel' | 'financieel'>;
  } = {},
) {
  const calls: Array<{ name: string; input: Record<string, unknown>; categories: readonly string[] }> = [];
  const recorder = new ToolCallRecorder();
  const run = vi.fn(async (call: Parameters<Parameters<typeof collectFacts>[0]['run']>[0]) => {
    calls.push({ name: call.name, input: call.input, categories: call.dataCategories });
    return (opties.antwoord ?? (() => ({ ok: true, data: { ok: true } })))(call.name);
  });

  return {
    calls,
    recorder,
    run,
    invoer: {
      pack: pack(opties.facts),
      specialist: {
        id: 'simple_reply' as const,
        toolScope: opties.toolScope ?? ['order.get', 'order.tracking', 'invoice.get'],
      },
      ctx: {
        envelope: ENVELOP,
        extracted: opties.extracted ?? { orderNumber: 'ORD-1' },
        resolved: {},
      },
      run,
      recorder,
      allowedCategories: opties.allowed ?? (['operationeel', 'commercieel'] as const),
    },
  };
}

describe('collectFacts', () => {
  it('haalt alleen op wat in de toolScope staat', async () => {
    const { invoer, calls } = opzet({ toolScope: ['order.get'] });
    const res = await collectFacts(invoer);

    expect(calls.map((c) => c.name)).toEqual(['order.get']);
    expect(res.facts.map((f) => f.id)).toEqual(['db.order']);
  });

  it('haalt niets op bij een lege toolScope', async () => {
    // `escalate` schrijft een doorverwijzing, `gdpr` hoort ordergegevens niet
    // te zien. Allebei krijgen ze niets, en dat is de bedoeling.
    const { invoer, run } = opzet({ toolScope: [] });
    const res = await collectFacts(invoer);

    expect(run).not.toHaveBeenCalled();
    expect(res.facts).toEqual([]);
  });

  it('slaat een bron over die niet over dit signaal gaat', async () => {
    const { invoer, calls } = opzet({ extracted: {} });
    const res = await collectFacts(invoer);

    expect(calls).toEqual([]);
    expect(res.skipped).toContain('order.get');
    expect(res.facts).toEqual([]);
  });

  it('laat een bron leunen op wat een eerdere opleverde', async () => {
    const { invoer, calls } = opzet({
      antwoord: (naam) =>
        naam === 'order.get'
          ? { ok: true, data: { trackingCode: '3STOTAL' } }
          : { ok: true, data: { status: 'onderweg' } },
    });
    const res = await collectFacts(invoer);

    expect(calls.find((c) => c.name === 'order.tracking')?.input).toEqual({ code: '3STOTAL' });
    expect(res.facts.map((f) => f.id)).toContain('db.tracking');
  });

  it('laat de run doorgaan als een bron niet antwoordt', async () => {
    // Het hele punt van fail-soft: geen feit betekent geen cijfer, niet een
    // gestrande mail.
    const { invoer } = opzet({
      antwoord: (naam) =>
        naam === 'order.get' ? { ok: false, error: 'timeout' } : { ok: true, data: {} },
    });
    const res = await collectFacts(invoer);

    expect(res.failures).toEqual([{ name: 'order.get', error: 'timeout' }]);
    expect(res.facts.map((f) => f.id)).toEqual(['db.invoice']);
  });

  it('vangt een bron af die gooit in plaats van een fout terug te geven', async () => {
    const { invoer } = opzet({
      antwoord: (naam) => {
        if (naam === 'order.get') throw new Error('kapot');
        return { ok: true, data: {} };
      },
    });
    const res = await collectFacts(invoer);

    expect(res.failures[0]?.name).toBe('order.get');
    expect(res.facts).toHaveLength(1);
  });

  it('legt elk feit vast bij de recorder, met het antwoord erbij', async () => {
    // Zonder deze registratie kan de grounding-laag een geciteerde waarde niet
    // aan een call koppelen, en valt elke claim weg.
    const { invoer, recorder } = opzet({ toolScope: ['order.get'] });
    await collectFacts(invoer);

    const rec = recorder.get('db.order');
    expect(rec?.tool).toBe('db.demo_orders');
    expect(rec?.result).toEqual({ ok: true });
  });

  it('registreert niets voor een bron die niets vond', async () => {
    const { invoer, recorder } = opzet({
      toolScope: ['invoice.get'],
      antwoord: () => ({ ok: true, data: null }),
    });
    const res = await collectFacts(invoer);

    expect(res.facts).toEqual([]);
    expect(recorder.has('db.invoice')).toBe(false);
    // Wel opgehaald, alleen niets gevonden: dat is geen fout.
    expect(res.failures).toEqual([]);
  });

  it('roept dezelfde bron met dezelfde invoer maar één keer aan', async () => {
    const zelfde: FactProvider = { ...FACTUUR, name: 'invoice.copy' };
    const { invoer, run } = opzet({
      facts: [FACTUUR, zelfde],
      toolScope: ['invoice.get', 'invoice.copy'],
    });
    await collectFacts(invoer);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('begrenst de categorieën van een bron tot wat de agent mag', async () => {
    // De factuurbron vraagt financieel; deze agent mag dat niet.
    const { invoer, calls } = opzet({ toolScope: ['invoice.get'] });
    await collectFacts(invoer);

    expect(calls[0]?.categories).toEqual([]);
  });

  it('stuurt de categorieën mee die wél mogen', async () => {
    const { invoer, calls } = opzet({
      toolScope: ['invoice.get'],
      allowed: ['operationeel', 'financieel'],
    });
    await collectFacts(invoer);

    expect(calls[0]?.categories).toEqual(['financieel']);
  });

  it('negeert een naam in de toolScope die geen bron is', async () => {
    const waarschuwing = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { invoer } = opzet({ toolScope: ['order.get', 'erp.bestaat_niet'] });
    const res = await collectFacts(invoer);

    expect(res.facts).toHaveLength(1);
    expect(waarschuwing).toHaveBeenCalledWith(expect.stringContaining('erp.bestaat_niet'));
    waarschuwing.mockRestore();
  });
});

describe('providersInScope', () => {
  it('houdt de volgorde van het pakket aan, niet die van de scope', async () => {
    // De volgorde op het pakket is wat een bron laat leunen op een eerdere.
    const gevonden = providersInScope([ORDER, TRACKING], ['order.tracking', 'order.get']);
    expect(gevonden.map((p) => p.name)).toEqual(['order.get', 'order.tracking']);
  });
});

describe('begrens', () => {
  it('geeft de doorsnede, in de volgorde van wat is toegestaan', () => {
    expect(begrens(['financieel', 'operationeel'], ['operationeel', 'financieel'])).toEqual([
      'operationeel',
      'financieel',
    ]);
  });

  it('geeft een lege lijst als de bron niets mag wat de agent mag', () => {
    expect(begrens(['financieel'], ['operationeel'])).toEqual([]);
  });
});

describe('sourceLabel', () => {
  it('noemt een tabel en een tool herkenbaar verschillend', () => {
    expect(sourceLabel({ kind: 'table', table: 'demo_orders' })).toBe('db.demo_orders');
    expect(sourceLabel({ kind: 'mcp', mcp: 'FACTUMAI_MCP_ERP_URL', tool: 'erp_get_order' })).toBe(
      'FACTUMAI_MCP_ERP_URL:erp_get_order',
    );
  });
});
