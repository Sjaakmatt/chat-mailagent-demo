/**
 * Het uploadpad: wie er door de deur komt, en wat er dan op de bus staat.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { hmacHex } from '@factumai/agent-core';

const emitted: Array<{ domain: string; type: string; payload: Record<string, unknown>; idempotencyKey: string }> = [];
let emitFaalt = false;

vi.mock('./emit.js', () => ({
  emitSignal: vi.fn(async (_env: unknown, input: never) => {
    if (emitFaalt) throw new Error('supabase onbereikbaar');
    emitted.push(input);
    return { signalId: 'sig_1', enqueued: true };
  }),
}));

const { handleUpload, UPLOAD_TYPE } = await import('./upload.js');
const { documentEnvelope } = await import('../hydrators/document.js');

const GEHEIM = 'geheim-van-de-cockpit';
const env = { UPLOAD_SECRET: GEHEIM } as never;

const MELDING = {
  bucket: 'documenten',
  path: 'inkoop/2026/F-2026-0007.pdf',
  filename: 'F-2026-0007.pdf',
  contentType: 'application/pdf',
  size: 84213,
  uploadedBy: 'anna@example.com',
  uploadedAt: '2026-08-21T09:12:00.000Z',
};

async function verzoek(
  opts: {
    body?: string;
    geheim?: string;
    pad?: string;
    method?: string;
    timestampOffset?: number;
    env?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const body = opts.body ?? JSON.stringify(MELDING);
  const ts = String(Math.floor(Date.now() / 1000) + (opts.timestampOffset ?? 0));
  const sig = await hmacHex(opts.geheim ?? GEHEIM, `${ts}.${body}`);
  const url = new URL(`https://agent.example.com${opts.pad ?? '/upload'}`);
  const request = new Request(url, {
    method: opts.method ?? 'POST',
    body: opts.method === 'GET' ? undefined : body,
    headers: { 'x-aios-timestamp': ts, 'x-aios-signature': `sha256=${sig}`, ...opts.headers },
  });
  return handleUpload(request, (opts.env ?? env) as never, url);
}

beforeEach(() => {
  emitted.length = 0;
  emitFaalt = false;
});

describe('POST /upload', () => {
  it('neemt een correct ondertekende melding aan en emit document.uploaded', async () => {
    const res = await verzoek();

    expect(res?.status).toBe(202);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ domain: 'document', type: UPLOAD_TYPE });
    expect(emitted[0]?.payload).toMatchObject({
      bucket: 'documenten',
      path: 'inkoop/2026/F-2026-0007.pdf',
      filename: 'F-2026-0007.pdf',
    });
  });

  it('zet geen bestandsinhoud op de bus, alleen de verwijzing', async () => {
    await verzoek();
    // Het signaal is een verwijzing. Bytes in de payload staan voorgoed in de
    // signaaltabel en zijn daar niet weg te krijgen.
    expect(JSON.stringify(emitted[0]?.payload)).not.toContain('base64');
    expect(emitted[0]?.payload.path).toBe('inkoop/2026/F-2026-0007.pdf');
  });

  it('weigert een verkeerde handtekening', async () => {
    const res = await verzoek({ geheim: 'iets anders' });
    expect(res?.status).toBe(401);
    expect(emitted).toHaveLength(0);
  });

  it('weigert een verzoek buiten het replay-venster', async () => {
    const res = await verzoek({ timestampOffset: -3600 });
    expect(res?.status).toBe(401);
  });

  it('is 404 zolang er geen geheim is ingericht', async () => {
    // Een vergeten secret hoort de deur dicht te houden, niet open te zetten.
    const res = await verzoek({ env: {} });
    expect(res?.status).toBe(404);
    expect(emitted).toHaveLength(0);
  });

  it('laat een ander pad met rust', async () => {
    expect(await verzoek({ pad: '/chat' })).toBeNull();
  });

  it('weigert een melding zonder bucket of pad', async () => {
    const res = await verzoek({ body: JSON.stringify({ filename: 'los.pdf' }) });
    expect(res?.status).toBe(400);
    expect(emitted).toHaveLength(0);
  });

  it('weigert onleesbare JSON', async () => {
    expect((await verzoek({ body: 'geen json' }))?.status).toBe(400);
  });

  it('valt terug op het laatste stuk van het pad als de naam ontbreekt', async () => {
    await verzoek({
      body: JSON.stringify({ bucket: 'documenten', path: 'inkoop/2026/F-9.pdf' }),
    });
    expect(emitted[0]?.payload.filename).toBe('F-9.pdf');
  });

  it('houdt een herhaalde melding van dezelfde upload op één sleutel', async () => {
    await verzoek();
    await verzoek();
    expect(emitted[0]?.idempotencyKey).toBe(emitted[1]?.idempotencyKey);
  });

  it('behandelt een nieuwe versie op hetzelfde pad als een nieuw document', async () => {
    // Een gecorrigeerde factuur op dezelfde plek is een ander document, en de
    // reviewer hoort 'm te zien.
    await verzoek();
    await verzoek({
      body: JSON.stringify({ ...MELDING, uploadedAt: '2026-08-22T09:00:00.000Z', size: 90000 }),
    });
    expect(emitted[0]?.idempotencyKey).not.toBe(emitted[1]?.idempotencyKey);
  });

  it('gebruikt een expliciete upload-id als die er is', async () => {
    await verzoek({ body: JSON.stringify({ ...MELDING, uploadId: 'up_123' }) });
    await verzoek({
      body: JSON.stringify({ ...MELDING, uploadId: 'up_123', size: 1 }),
    });
    expect(emitted[0]?.idempotencyKey).toBe(emitted[1]?.idempotencyKey);
  });

  it('geeft 503 als emitten mislukt, zodat de uploader opnieuw probeert', async () => {
    emitFaalt = true;
    const res = await verzoek();
    expect(res?.status).toBe(503);
  });

  it('weigert een andere methode', async () => {
    expect((await verzoek({ method: 'GET' }))?.status).toBe(405);
  });

  it('levert een envelop op waarin het bestand als bijlage hangt', async () => {
    // Het bewijs dat de route en de hydrator op elkaar aansluiten: wat hier de
    // bus op gaat, leest de lus als een document met een vindbaar bestand.
    await verzoek();
    const envelop = documentEnvelope({
      id: 'sig_1',
      organizationId: 'org_demo',
      domain: 'document',
      type: UPLOAD_TYPE,
      payload: emitted[0]!.payload,
      status: 'NEW',
      idempotencyKey: emitted[0]!.idempotencyKey,
      receivedAt: '2026-08-21T09:12:01.000Z',
    });

    expect(envelop.subject).toBe('F-2026-0007.pdf');
    // Geen verzonnen inhoud: de extractie hoort in de hydrator, en die is er
    // nog niet.
    expect(envelop.body).toBe('');
    expect(envelop.attachments[0]).toMatchObject({
      name: 'F-2026-0007.pdf',
      contentType: 'application/pdf',
      size: 84213,
      path: 'inkoop/2026/F-2026-0007.pdf',
    });
    expect(envelop.participants[0]?.address).toBe('anna@example.com');
    expect(envelop.occurredAt).toBe('2026-08-21T09:12:00.000Z');
  });
});
