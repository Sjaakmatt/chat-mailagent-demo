import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hmacHex } from '@factumai/agent-core';

// De emit raakt de database; hier gaat het om wie er door de deur komt.
const emitted: unknown[] = [];
let emitFaalt = false;

vi.mock('./emit.js', () => ({
  emitSignal: vi.fn(async (_env: unknown, input: unknown) => {
    if (emitFaalt) throw new Error('supabase onbereikbaar');
    emitted.push(input);
    return { signalId: 'sig_1', enqueued: true };
  }),
}));

const { handleWebhook } = await import('./webhook.js');

const GEHEIM = 'geheim-van-exact';
const env = { WEBHOOK_SECRET_EXACT: GEHEIM } as never;

async function verzoek(
  opts: {
    pad?: string;
    body?: string;
    geheim?: string;
    timestampOffset?: number;
    method?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const body = opts.body ?? '{"type":"invoice.due","invoiceNumber":"F-2026-0007"}';
  const ts = String(Math.floor(Date.now() / 1000) + (opts.timestampOffset ?? 0));
  const sig = await hmacHex(opts.geheim ?? GEHEIM, `${ts}.${body}`);
  const url = new URL(`https://agent.example.com${opts.pad ?? '/hooks/exact'}`);
  const request = new Request(url, {
    method: opts.method ?? 'POST',
    body: opts.method === 'GET' ? undefined : body,
    headers: {
      'x-aios-timestamp': ts,
      'x-aios-signature': `sha256=${sig}`,
      ...opts.headers,
    },
  });
  return handleWebhook(request, env, url);
}

beforeEach(() => {
  emitted.length = 0;
  emitFaalt = false;
});

describe('POST /hooks/:bron', () => {
  it('neemt een correct ondertekend event aan en emit het', async () => {
    const res = await verzoek();
    expect(res?.status).toBe(202);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      domain: 'exact',
      type: 'exact.invoice.due',
    });
  });

  it('zet de body ongewijzigd in de payload', async () => {
    await verzoek();
    const input = emitted[0] as { payload: Record<string, unknown> };
    // Het bewijsstuk blijft zoals de bron het stuurde; wat het betekent weet de
    // hydrator van dat domein.
    expect(input.payload.invoiceNumber).toBe('F-2026-0007');
  });

  it('weigert een verkeerde handtekening met 401', async () => {
    const res = await verzoek({ geheim: 'het-verkeerde-geheim' });
    expect(res?.status).toBe(401);
    expect(emitted).toHaveLength(0);
  });

  it('weigert een verzoek buiten het replay-venster', async () => {
    const res = await verzoek({ timestampOffset: -3600 });
    expect(res?.status).toBe(401);
    expect(emitted).toHaveLength(0);
  });

  it('geeft 404 op een bron zonder ingericht geheim', async () => {
    // Geen 401: dát er een bron bestaat is zelf informatie.
    const res = await verzoek({ pad: '/hooks/onbekend' });
    expect(res?.status).toBe(404);
    expect(emitted).toHaveLength(0);
  });

  it('geeft 404 op een bronnaam die geen bronnaam is', async () => {
    const res = await verzoek({ pad: '/hooks/..%2Fetc' });
    expect(res?.status).toBe(404);
  });

  it('laat andere paden met rust', async () => {
    const url = new URL('https://agent.example.com/__poller/status');
    expect(await handleWebhook(new Request(url), env, url)).toBeNull();
  });

  it('weigert een andere methode dan POST', async () => {
    const res = await verzoek({ method: 'GET' });
    expect(res?.status).toBe(405);
  });

  it('weigert een te grote body op de gemelde lengte', async () => {
    const res = await verzoek({
      headers: { 'content-length': String(10 * 1024 * 1024) },
    });
    expect(res?.status).toBe(413);
    expect(emitted).toHaveLength(0);
  });

  it('gebruikt het event-id van de bron als idempotency-sleutel', async () => {
    await verzoek({ headers: { 'x-aios-event-id': 'evt_42' } });
    expect(emitted[0]).toMatchObject({ idempotencyKey: 'hook:exact:evt_42' });
  });

  it('neemt het gebeurtenistype uit de header als die er is', async () => {
    await verzoek({ headers: { 'x-aios-event-type': 'payment.received' } });
    expect(emitted[0]).toMatchObject({ type: 'exact.payment.received' });
  });

  it('zet geen dubbele bron-prefix op het type', async () => {
    await verzoek({ headers: { 'x-aios-event-type': 'exact.payment.received' } });
    expect(emitted[0]).toMatchObject({ type: 'exact.payment.received' });
  });

  it('bewaart een body die geen JSON is in plaats van hem te laten vallen', async () => {
    await verzoek({ body: 'dit is geen json' });
    const input = emitted[0] as { payload: Record<string, unknown> };
    expect(input.payload.body).toBe('dit is geen json');
  });

  it('geeft 503 als emitten mislukt, zodat de bron opnieuw probeert', async () => {
    emitFaalt = true;
    const res = await verzoek();
    // 5xx en geen 4xx: het ligt aan ons, en de idempotency-sleutel maakt een
    // retry veilig.
    expect(res?.status).toBe(503);
  });
});
