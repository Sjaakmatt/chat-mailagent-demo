/**
 * De poll-intake: wat er gebeurt tussen "de bron antwoordt" en "er staat een
 * signaal op de bus".
 *
 * De MCP en de database zijn hier nep; wat getoetst wordt is de mechaniek
 * eromheen — de cursor, de ontdubbeling en het gedrag bij een bron die niet
 * antwoordt.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PollDefinition } from '@factumai/agent-core';

const emitted: Array<{ idempotencyKey: string; payload: Record<string, unknown> }> = [];
let emitFaaltVanaf: string | null = null;

/** Wat er in `aios_poll_cursors` zou staan, per (module, bron). */
const cursors = new Map<string, { cursor: string | null; last_error: string | null }>();
let dbFaalt = false;

vi.mock('./emit.js', () => ({
  emitSignal: vi.fn(async (_env: unknown, input: { idempotencyKey: string; payload: Record<string, unknown> }) => {
    if (emitFaaltVanaf && input.idempotencyKey.endsWith(emitFaaltVanaf)) {
      throw new Error('bus onbereikbaar');
    }
    emitted.push(input);
    return { signalId: `sig_${emitted.length}`, enqueued: true };
  }),
  intakeCtx: () => ({ organizationId: 'org_demo', agentId: 'aios-agent', toolCallId: 'aios-intake' }),
  intakeClient: () => ({
    tableUrl: (tabel: string) => new URL(`https://db.example.com/rest/v1/${tabel}`),
    async request(_ctx: unknown, url: URL, init: { method: string; body?: string }) {
      if (dbFaalt) throw new Error('supabase onbereikbaar');
      if (init.method === 'GET') {
        const rij = cursors.get(sleutelUit(url));
        return rij ? [{ cursor: rij.cursor }] : [];
      }
      const rij = JSON.parse(init.body ?? '{}') as Record<string, string | null>;
      const bestaand = cursors.get(`${rij.module}/${rij.source}`);
      cursors.set(`${rij.module}/${rij.source}`, {
        // Zoals PostgREST het doet: een veld dat niet meegestuurd wordt, blijft staan.
        cursor: rij.cursor !== undefined ? rij.cursor : (bestaand?.cursor ?? null),
        last_error: rij.last_error ?? null,
      });
      return null;
    },
  }),
}));

const callMcp = vi.fn();
vi.mock('@factumai/agent-core/mcp', () => ({
  callMcp: (...a: unknown[]) => callMcp(...a),
  cfAccessHeaders: () => ({}),
  mcpBearer: () => 'geheim',
}));

const { runPolls } = await import('./poll.js');

function sleutelUit(url: URL): string {
  const module = (url.searchParams.get('module') ?? '').replace('eq.', '');
  const source = (url.searchParams.get('source') ?? '').replace('eq.', '');
  return `${module}/${source}`;
}

const env = {
  AIOS_ORG_ID: 'org_demo',
  AIOS_SUPABASE_URL: 'https://db.example.com',
  AIOS_SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  FACTUMAI_MCP_ERP_URL: 'https://mcp-erp.example.com/mcp',
} as never;

/** Een poll zoals een module 'm zou meebrengen. */
const POLL: PollDefinition = {
  source: 'openstaande_posten',
  description: 'Facturen die vervallen zijn',
  mcp: 'FACTUMAI_MCP_ERP_URL',
  tool: 'erp_list_overdue_invoices',
  input: { status: 'overdue' },
  dataCategories: ['financieel', 'operationeel'],
  cursorField: 'updatedAt',
  toSignal: (rij) => ({
    domain: 'erp',
    type: 'erp.invoice.overdue',
    key: String(rij.number),
    payload: { subject: `Factuur ${rij.number}`, bodyText: '', refs: { invoiceNumber: rij.number } },
  }),
};

const polls = [{ module: 'administratie', poll: POLL }];

function factuur(nummer: string, updatedAt: string) {
  return { number: nummer, updatedAt, amount: 120 };
}

beforeEach(() => {
  emitted.length = 0;
  emitFaaltVanaf = null;
  cursors.clear();
  dbFaalt = false;
  callMcp.mockReset();
});

describe('runPolls', () => {
  it('emit per opgehaalde rij een signaal en zet de cursor op de hoogste', async () => {
    callMcp.mockResolvedValue({
      ok: true,
      data: { items: [factuur('F-1', '2026-08-20T10:00:00Z'), factuur('F-2', '2026-08-21T10:00:00Z')] },
    });

    const res = await runPolls(env, new Date('2026-08-21T12:00:00Z'), polls);

    expect(res).toMatchObject({ bekeken: 1, nieuw: 2, geemit: 2, mislukt: 0 });
    expect(cursors.get('administratie/openstaande_posten')).toEqual({
      cursor: '2026-08-21T10:00:00Z',
      last_error: null,
    });
  });

  it('haalt de tweede ronde alleen op wat na de cursor komt', async () => {
    callMcp.mockResolvedValue({
      ok: true,
      data: [factuur('F-1', '2026-08-20T10:00:00Z'), factuur('F-2', '2026-08-21T10:00:00Z')],
    });
    await runPolls(env, new Date('2026-08-21T12:00:00Z'), polls);
    emitted.length = 0;

    // Dezelfde twee rijen plus één nieuwe: een bron die geen `since` kent.
    callMcp.mockResolvedValue({
      ok: true,
      data: [
        factuur('F-1', '2026-08-20T10:00:00Z'),
        factuur('F-2', '2026-08-21T10:00:00Z'),
        factuur('F-3', '2026-08-22T10:00:00Z'),
      ],
    });
    const res = await runPolls(env, new Date('2026-08-22T12:00:00Z'), polls);

    expect(res.nieuw).toBe(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.payload.subject).toBe('Factuur F-3');
  });

  it('stuurt de cursor mee als `since` zodra hij bekend is', async () => {
    callMcp.mockResolvedValue({ ok: true, data: [factuur('F-1', '2026-08-20T10:00:00Z')] });
    await runPolls(env, new Date('2026-08-21T12:00:00Z'), polls);
    await runPolls(env, new Date('2026-08-22T12:00:00Z'), polls);

    // Eerste ronde: geen cursor, dus geen `since`. Tweede ronde wel.
    expect(callMcp.mock.calls[0]![3]).not.toHaveProperty('since');
    expect(callMcp.mock.calls[1]![3]).toMatchObject({
      status: 'overdue',
      since: '2026-08-20T10:00:00Z',
    });
  });

  it('dedupliceert op de cursorwaarde, niet op het moment van ophalen', async () => {
    callMcp.mockResolvedValue({ ok: true, data: [factuur('F-1', '2026-08-20T10:00:00Z')] });
    await runPolls(env, new Date('2026-08-21T12:00:00Z'), polls);

    expect(emitted[0]?.idempotencyKey).toBe(
      'poll:administratie:openstaande_posten:2026-08-20T10:00:00Z',
    );
  });

  it('stuurt de datacategorieën mee, begrensd door wat de agent mag', async () => {
    callMcp.mockResolvedValue({ ok: true, data: [] });
    await runPolls(env, new Date('2026-08-21T12:00:00Z'), polls);

    // De poll vraagt financieel + operationeel; de agent mag standaard
    // operationeel + commercieel. Wat overblijft is de doorsnede.
    expect(callMcp.mock.calls[0]![1]).toMatchObject({ dataCategories: ['operationeel'] });
  });

  it('laat de cursor staan als de MCP niet antwoordt, en legt de fout vast', async () => {
    callMcp.mockResolvedValue({ ok: true, data: [factuur('F-1', '2026-08-20T10:00:00Z')] });
    await runPolls(env, new Date('2026-08-21T12:00:00Z'), polls);

    callMcp.mockResolvedValue({ ok: false, error: 'timeout na 30s' });
    const res = await runPolls(env, new Date('2026-08-21T13:00:00Z'), polls);

    expect(res.mislukt).toBe(1);
    expect(cursors.get('administratie/openstaande_posten')).toEqual({
      // Onaangeroerd: de volgende ronde begint op hetzelfde punt.
      cursor: '2026-08-20T10:00:00Z',
      last_error: 'timeout na 30s',
    });
  });

  it('stopt bij de eerste rij die niet op de bus komt en laat de cursor daar staan', async () => {
    // Doorlopen zou F-2 overslaan zodra F-3 wél lukt: stil dataverlies.
    emitFaaltVanaf = '2026-08-21T10:00:00Z';
    callMcp.mockResolvedValue({
      ok: true,
      data: [
        factuur('F-1', '2026-08-20T10:00:00Z'),
        factuur('F-2', '2026-08-21T10:00:00Z'),
        factuur('F-3', '2026-08-22T10:00:00Z'),
      ],
    });

    const res = await runPolls(env, new Date('2026-08-22T12:00:00Z'), polls);

    expect(emitted.map((e) => e.payload.subject)).toEqual(['Factuur F-1']);
    expect(res.mislukt).toBe(1);
    expect(cursors.get('administratie/openstaande_posten')?.cursor).toBe('2026-08-20T10:00:00Z');
  });

  it('slaat een bron zonder URL over en maakt dat zichtbaar', async () => {
    const zonderUrl = [{ module: 'administratie', poll: { ...POLL, mcp: 'FACTUMAI_MCP_BANK_URL' } }];
    const res = await runPolls(env, new Date('2026-08-21T12:00:00Z'), zonderUrl);

    expect(callMcp).not.toHaveBeenCalled();
    expect(res.mislukt).toBe(1);
    expect(cursors.get('administratie/openstaande_posten')?.last_error).toContain(
      'FACTUMAI_MCP_BANK_URL',
    );
  });

  it('slaat een rij zonder signaal over, maar schuift de cursor er wel overheen', async () => {
    // Anders komt dezelfde rij elke ronde opnieuw langs.
    const stil: PollDefinition = { ...POLL, toSignal: (rij) => (rij.number === 'F-1' ? null : POLL.toSignal(rij)) };
    callMcp.mockResolvedValue({
      ok: true,
      data: [factuur('F-1', '2026-08-20T10:00:00Z'), factuur('F-2', '2026-08-21T10:00:00Z')],
    });

    await runPolls(env, new Date('2026-08-21T12:00:00Z'), [{ module: 'administratie', poll: stil }]);

    expect(emitted).toHaveLength(1);
    expect(cursors.get('administratie/openstaande_posten')?.cursor).toBe('2026-08-21T10:00:00Z');
  });

  it('laat één omvallende bron de andere niet meenemen', async () => {
    const tweede: PollDefinition = { ...POLL, source: 'leveringen' };
    callMcp
      .mockRejectedValueOnce(new Error('netwerk weg'))
      .mockResolvedValueOnce({ ok: true, data: [factuur('F-9', '2026-08-21T10:00:00Z')] });

    const res = await runPolls(env, new Date('2026-08-21T12:00:00Z'), [
      ...polls,
      { module: 'administratie', poll: tweede },
    ]);

    expect(res.bekeken).toBe(2);
    expect(res.geemit).toBe(1);
    expect(res.mislukt).toBe(1);
  });

  it('doet niets als geen enkele module een bron meebrengt', async () => {
    const res = await runPolls(env, new Date('2026-08-21T12:00:00Z'), []);
    expect(res).toEqual({ bekeken: 0, nieuw: 0, geemit: 0, mislukt: 0 });
    expect(callMcp).not.toHaveBeenCalled();
  });

  it('bevraagt de bron niet als de cursor onleesbaar is', async () => {
    // Zonder cursor zouden we de hele bron opnieuw ophalen; dan is overslaan
    // goedkoper en stiller.
    dbFaalt = true;
    const res = await runPolls(env, new Date('2026-08-21T12:00:00Z'), polls);

    expect(callMcp).not.toHaveBeenCalled();
    expect(res.mislukt).toBe(1);
  });
});
