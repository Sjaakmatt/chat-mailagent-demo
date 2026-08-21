import { describe, expect, it } from 'vitest';
import { KLANTENSERVICE_TRIGGERS } from './triggers.js';
import { klantenservicePack } from './pack.js';
import type { TriggerContext } from '../../triggers/index.js';

const NU = new Date('2026-08-21T08:00:00.000Z');

function ticket(over: Record<string, unknown> = {}) {
  return {
    id: 'tic_pro_2608_0012',
    number: 'PRO-2608-0012',
    status: 'OPEN',
    category: 'retour_ruilen',
    summary: 'Retour van twee artikelen aangemeld',
    contact_email: 'j.dekker@example.com',
    order_reference: 'ORD-2411-0022',
    created_at: '2026-08-15T09:00:00.000Z',
    ...over,
  };
}

/** Een context die vaste rijen teruggeeft en de gestelde vraag onthoudt. */
function context(rijen: unknown[], config: Record<string, unknown> = {}) {
  const vragen: Array<{ tabel: string; params: Record<string, string> }> = [];
  const ctx: TriggerContext = {
    organizationId: 'org_demo',
    now: NU,
    config,
    async query<T>(tabel: string, params: Record<string, string>): Promise<T[]> {
      vragen.push({ tabel, params });
      return rijen as T[];
    },
  };
  return { ctx, vragen };
}

const opvolging = KLANTENSERVICE_TRIGGERS.automations![0]!;

describe('ticket_opvolging', () => {
  it('hangt aan de module en wordt geclaimd door zijn eigen signaaltype', () => {
    expect(opvolging.name).toBe('ticket_opvolging');
    expect(klantenservicePack.claims).toContainEqual({
      domain: 'schedule',
      type: 'schedule.ticket_opvolging',
    });
  });

  it('vraagt alleen openstaande tickets ouder dan de drempel', async () => {
    const { ctx, vragen } = context([]);
    await opvolging.expand(ctx);

    expect(vragen[0]?.tabel).toBe('aios_tickets');
    expect(vragen[0]?.params.status).toBe('in.(OPEN,IN_PROGRESS)');
    // Standaard drie dagen: 21 augustus min 3 = 18 augustus.
    expect(vragen[0]?.params.created_at).toBe('lt.2026-08-18T08:00:00.000Z');
  });

  it('neemt de drempel uit de config van de rij', async () => {
    const { ctx, vragen } = context([], { dagen: 7 });
    await opvolging.expand(ctx);
    expect(vragen[0]?.params.created_at).toBe('lt.2026-08-14T08:00:00.000Z');
  });

  it('valt terug op de standaard bij een onbruikbare drempel', async () => {
    // Een 0 zou dagelijkse ruis geven op elk vers ticket.
    for (const dagen of [0, -1, 'veel', null]) {
      const { ctx, vragen } = context([], { dagen });
      await opvolging.expand(ctx);
      expect(vragen[0]?.params.created_at, String(dagen)).toBe('lt.2026-08-18T08:00:00.000Z');
    }
  });

  it('maakt één signaal per ticket, met het nummer als sleutel', async () => {
    // De hele lus rust op "één signaal, één voorstel": een verzamelbericht zou
    // de reviewer dwingen alles of niets te nemen.
    const { ctx } = context([ticket(), ticket({ id: 'tic_2', number: 'PRO-2608-0013' })]);
    const drafts = await opvolging.expand(ctx);

    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.key)).toEqual(['PRO-2608-0012', 'PRO-2608-0013']);
  });

  it('zet alleen feiten in de tekst die uit het ticket komen', async () => {
    const { ctx } = context([ticket()]);
    const [draft] = await opvolging.expand(ctx);
    const body = String(draft!.payload.bodyText);

    expect(body).toContain('PRO-2608-0012');
    expect(body).toContain('5 dagen open');
    expect(body).toContain('Retour van twee artikelen aangemeld');
    expect(body).toContain('ORD-2411-0022');
  });

  it('draagt de verwijzingen mee zodat de specialist ze niet uit tekst hoeft te vissen', async () => {
    const { ctx } = context([ticket()]);
    const [draft] = await opvolging.expand(ctx);
    expect(draft!.payload.refs).toEqual({
      ticketId: 'tic_pro_2608_0012',
      ticketNumber: 'PRO-2608-0012',
      orderNumber: 'ORD-2411-0022',
    });
  });

  it('zet de klant als afzender, zodat identificatie er iets mee kan', async () => {
    const { ctx } = context([ticket()]);
    const [draft] = await opvolging.expand(ctx);
    expect(draft!.payload.from).toBe('j.dekker@example.com');
  });

  it('slaat een ticket zonder mailadres over', async () => {
    // Zonder terugkoppelkanaal is een opvolgbericht een concept dat nergens
    // heen kan.
    const { ctx } = context([ticket({ contact_email: null }), ticket({ contact_email: '  ' })]);
    expect(await opvolging.expand(ctx)).toEqual([]);
  });

  it('geeft niets terug als er niets te lang openstaat', async () => {
    // De normale uitkomst: meestal is er niets aan de hand.
    const { ctx } = context([]);
    expect(await opvolging.expand(ctx)).toEqual([]);
  });

  it('laat een ticket zonder ordernummer die verwijzing weg', async () => {
    const { ctx } = context([ticket({ order_reference: null })]);
    const [draft] = await opvolging.expand(ctx);
    expect(draft!.payload.refs).toEqual({
      ticketId: 'tic_pro_2608_0012',
      ticketNumber: 'PRO-2608-0012',
    });
  });
});
