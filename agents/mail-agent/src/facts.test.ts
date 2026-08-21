/**
 * De feitenrunner: hoe een bron van het pakket een echte call wordt.
 *
 * Het netwerk is hier nep. Wat getoetst wordt is de vertaling — welke query
 * eruit komt, welke context meegaat, en wat er gebeurt als er geen bron is.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const callMcp = vi.fn();
vi.mock('@factumai/agent-core/mcp', () => ({
  callMcp: (...a: unknown[]) => callMcp(...a),
  cfAccessHeaders: () => ({}),
  mcpBearer: () => 'geheim',
}));

const { factRunner } = await import('./facts.js');

const env = {
  AIOS_ORG_ID: 'org_demo',
  AIOS_SUPABASE_URL: 'https://db.example.com',
  AIOS_SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  FACTUMAI_MCP_ERP_URL: 'https://mcp-erp.example.com/mcp',
} as never;

const fetches: Array<{ url: string; init: RequestInit }> = [];
const echteFetch = globalThis.fetch;

beforeEach(() => {
  fetches.length = 0;
  callMcp.mockReset();
  globalThis.fetch = vi.fn(async (url: URL | string, init: RequestInit) => {
    fetches.push({ url: String(url), init });
    return new Response(JSON.stringify([{ data: { status: 'verzonden' } }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as never;
});

afterEach(() => {
  globalThis.fetch = echteFetch;
});

describe('een tabel als bron', () => {
  it('zet de invoer van de bron letterlijk om in queryparameters', async () => {
    // Letterlijk en zonder eigen query-taal ertussen: die zou een tweede plek
    // zijn waar een filter kan verdwijnen, en dan gaan de feiten over de
    // verkeerde order.
    const res = await factRunner(env)({
      source: { kind: 'table', table: 'demo_orders' },
      input: { order_number: 'eq.ORD-1', select: 'data', limit: '1' },
      dataCategories: ['operationeel'],
      name: 'order.get',
    });

    expect(res.ok).toBe(true);
    const url = new URL(fetches[0]!.url);
    expect(url.pathname).toBe('/rest/v1/demo_orders');
    expect(url.searchParams.get('order_number')).toBe('eq.ORD-1');
    expect(url.searchParams.get('select')).toBe('data');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('geeft altijd een lijst terug, ook bij een leeg antwoord', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as never;

    const res = await factRunner(env)({
      source: { kind: 'table', table: 'demo_invoices' },
      input: { order_number: 'eq.ORD-9' },
      dataCategories: [],
      name: 'invoice.get',
    });

    expect(res).toEqual({ ok: true, data: [] });
  });

  it('geeft een fout terug in plaats van te gooien als de database weigert', async () => {
    globalThis.fetch = vi.fn(async () => new Response('kapot', { status: 400 })) as never;

    const res = await factRunner(env)({
      source: { kind: 'table', table: 'demo_orders' },
      input: {},
      dataCategories: [],
      name: 'order.get',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('demo_orders');
  });
});

describe('een MCP als bron', () => {
  it('zoekt de URL op via de env-sleutel van de bron', async () => {
    callMcp.mockResolvedValue({ ok: true, data: { number: 'ORD-1' } });

    const res = await factRunner(env)({
      source: { kind: 'mcp', mcp: 'FACTUMAI_MCP_ERP_URL', tool: 'erp_get_order' },
      input: { orderNumber: 'ORD-1' },
      dataCategories: ['operationeel', 'financieel'],
      name: 'order.get',
    });

    expect(res).toEqual({ ok: true, data: { number: 'ORD-1' } });
    expect(callMcp.mock.calls[0][0]).toMatchObject({ url: 'https://mcp-erp.example.com/mcp' });
    expect(callMcp.mock.calls[0][2]).toBe('erp_get_order');
    expect(callMcp.mock.calls[0][3]).toEqual({ orderNumber: 'ORD-1' });
  });

  it('stuurt de datacategorieën mee op de call', async () => {
    // Zonder dit snijdt de MCP terug naar operationeel en verdwijnen velden
    // stilzwijgend (docs/RECHTEN.md).
    callMcp.mockResolvedValue({ ok: true, data: {} });
    await factRunner(env)({
      source: { kind: 'mcp', mcp: 'FACTUMAI_MCP_ERP_URL', tool: 'erp_get_order' },
      input: {},
      dataCategories: ['financieel'],
      name: 'order.get',
    });

    expect(callMcp.mock.calls[0][1]).toMatchObject({
      organizationId: 'org_demo',
      dataCategories: ['financieel'],
    });
  });

  it('meldt een ontbrekende URL met de sleutel erbij', async () => {
    // Zo ziet een vergeten secret eruit; de naam van de var is dan het enige
    // dat je verder helpt.
    const res = await factRunner(env)({
      source: { kind: 'mcp', mcp: 'FACTUMAI_MCP_BANK_URL', tool: 'bank_get_mutations' },
      input: {},
      dataCategories: [],
      name: 'bank.mutations',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('FACTUMAI_MCP_BANK_URL');
    expect(callMcp).not.toHaveBeenCalled();
  });
});
