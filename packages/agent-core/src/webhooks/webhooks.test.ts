import { describe, expect, it } from 'vitest';
import {
  hmacHex,
  isValidSourceName,
  timingSafeEqual,
  verifyWebhook,
  webhookIdempotencyKey,
  webhookSecretKey,
  MAX_WEBHOOK_BODY_BYTES,
  REPLAY_WINDOW_SECONDS,
} from './index.js';

const GEHEIM = 'geheim-van-deze-bron';
const NU = Date.parse('2026-08-21T10:00:00.000Z');

/** Een correct ondertekend verzoek, zoals de bron het zou sturen. */
async function ondertekend(body: string, opts: { offsetSeconden?: number } = {}) {
  const timestamp = String(Math.floor(NU / 1000) + (opts.offsetSeconden ?? 0));
  return {
    body,
    timestamp,
    signature: `sha256=${await hmacHex(GEHEIM, `${timestamp}.${body}`)}`,
    secret: GEHEIM,
    now: NU,
  };
}

describe('verifyWebhook', () => {
  it('laat een correct ondertekend verzoek door', async () => {
    const res = await verifyWebhook(await ondertekend('{"type":"invoice.due"}'));
    expect(res).toEqual({ ok: true });
  });

  it('accepteert de handtekening ook zonder sha256-prefix', async () => {
    const req = await ondertekend('{"a":1}');
    req.signature = req.signature.replace('sha256=', '');
    expect((await verifyWebhook(req)).ok).toBe(true);
  });

  it('weigert een verzoek zonder ingericht geheim', async () => {
    const req = await ondertekend('{}');
    const res = await verifyWebhook({ ...req, secret: undefined });
    expect(res).toMatchObject({ ok: false, reason: 'geen_geheim' });
  });

  it('weigert een verkeerde handtekening', async () => {
    const req = await ondertekend('{"bedrag":10}');
    // Eén teken anders: precies het geval waar een niet-constante vergelijking
    // informatie over zou lekken.
    const gesloopt = req.signature.slice(0, -1) + (req.signature.endsWith('a') ? 'b' : 'a');
    const res = await verifyWebhook({ ...req, signature: gesloopt });
    expect(res).toMatchObject({ ok: false, reason: 'handtekening_klopt_niet' });
  });

  it('weigert een body die na ondertekening is gewijzigd', async () => {
    const req = await ondertekend('{"bedrag":10}');
    const res = await verifyWebhook({ ...req, body: '{"bedrag":10000}' });
    expect(res).toMatchObject({ ok: false, reason: 'handtekening_klopt_niet' });
  });

  it('weigert een ontbrekende handtekening of timestamp', async () => {
    const req = await ondertekend('{}');
    expect(await verifyWebhook({ ...req, signature: null })).toMatchObject({
      reason: 'geen_handtekening',
    });
    expect(await verifyWebhook({ ...req, timestamp: null })).toMatchObject({
      reason: 'geen_timestamp',
    });
  });

  it('weigert een onleesbare timestamp', async () => {
    const req = await ondertekend('{}');
    expect(await verifyWebhook({ ...req, timestamp: 'gisteren' })).toMatchObject({
      reason: 'timestamp_onleesbaar',
    });
  });

  it('weigert een verzoek buiten het replay-venster', async () => {
    const oud = await ondertekend('{}', { offsetSeconden: -(REPLAY_WINDOW_SECONDS + 1) });
    expect(await verifyWebhook(oud)).toMatchObject({ reason: 'buiten_venster' });
  });

  it('weigert een timestamp uit de toekomst net zo hard', async () => {
    // Een vooruitlopende klok bij de bron hoort te worden gemeld, niet
    // stilzwijgend geaccepteerd.
    const toekomst = await ondertekend('{}', { offsetSeconden: REPLAY_WINDOW_SECONDS + 1 });
    expect(await verifyWebhook(toekomst)).toMatchObject({ reason: 'buiten_venster' });
  });

  it('laat een verzoek binnen het venster wél door', async () => {
    const bijna = await ondertekend('{}', { offsetSeconden: -(REPLAY_WINDOW_SECONDS - 5) });
    expect((await verifyWebhook(bijna)).ok).toBe(true);
  });

  it('weigert een te grote body vóór het rekenwerk', async () => {
    const groot = 'x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1);
    const res = await verifyWebhook({
      body: groot,
      signature: 'sha256=maakt-niet-uit',
      timestamp: String(Math.floor(NU / 1000)),
      secret: GEHEIM,
      now: NU,
    });
    expect(res).toMatchObject({ ok: false, reason: 'body_te_groot' });
  });

  it('bindt de handtekening aan de timestamp', async () => {
    // De kern van de replay-bescherming: een geldige handtekening van vijf
    // minuten geleden opnieuw indienen met een verse timestamp moet falen.
    const oud = await ondertekend('{"a":1}', { offsetSeconden: -600 });
    const res = await verifyWebhook({
      ...oud,
      timestamp: String(Math.floor(NU / 1000)),
    });
    expect(res).toMatchObject({ ok: false, reason: 'handtekening_klopt_niet' });
  });
});

describe('timingSafeEqual', () => {
  it('is waar bij gelijk', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });
  it('is onwaar bij een ander teken of een andere lengte', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('idempotency-sleutel', () => {
  it('gebruikt het event-id van de bron als die er is', async () => {
    const sleutel = await webhookIdempotencyKey({
      source: 'exact',
      eventId: 'evt_123',
      body: '{}',
    });
    expect(sleutel).toBe('hook:exact:evt_123');
  });

  it('valt terug op een digest van de body', async () => {
    const a = await webhookIdempotencyKey({ source: 'exact', eventId: null, body: '{"a":1}' });
    const b = await webhookIdempotencyKey({ source: 'exact', eventId: null, body: '{"a":1}' });
    const c = await webhookIdempotencyKey({ source: 'exact', eventId: null, body: '{"a":2}' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('houdt bronnen uit elkaar', async () => {
    const a = await webhookIdempotencyKey({ source: 'exact', eventId: 'evt_1', body: '{}' });
    const b = await webhookIdempotencyKey({ source: 'bank', eventId: 'evt_1', body: '{}' });
    expect(a).not.toBe(b);
  });
});

describe('bronnamen', () => {
  it('vertaalt een bron naar zijn env-sleutel', () => {
    expect(webhookSecretKey('exact')).toBe('WEBHOOK_SECRET_EXACT');
    expect(webhookSecretKey('exact-online')).toBe('WEBHOOK_SECRET_EXACT_ONLINE');
  });

  it('laat alleen nette bronnamen toe', () => {
    expect(isValidSourceName('exact')).toBe(true);
    expect(isValidSourceName('exact-online')).toBe(true);
    // Een naam die een env-sleutel in gaat en het domein van een signaal wordt,
    // hoort geen pad, spatie of hoofdletter te bevatten.
    expect(isValidSourceName('../etc')).toBe(false);
    expect(isValidSourceName('Exact')).toBe(false);
    expect(isValidSourceName('')).toBe(false);
    expect(isValidSourceName('-begint-met-streepje')).toBe(false);
    expect(isValidSourceName('x'.repeat(33))).toBe(false);
  });
});
