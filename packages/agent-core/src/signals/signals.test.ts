import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemorySignalConsumer, PgmqSignalConsumer } from './index.js';

const PROJECT_URL = 'https://platform.supabase.co';
const SERVICE_KEY = 'service-role-secret';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PgmqSignalConsumer', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function consumer(): PgmqSignalConsumer {
    return PgmqSignalConsumer.fromServiceRole({
      projectUrl: PROJECT_URL,
      serviceRoleKey: SERVICE_KEY,
    });
  }

  it('leest via aios_read_signals en mapt naar QueuedSignal', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { msg_id: 7, read_ct: 1, enqueued_at: '2026-06-14T00:00:00Z', message: { signalId: 'sig-1' } },
        { msg_id: 8, read_ct: 2, enqueued_at: null, message: { signalId: 'sig-2' } },
      ]),
    );

    const batch = await consumer().read({ count: 5, vtSeconds: 30 });
    expect(batch).toEqual([
      { msgId: 7, readCount: 1, enqueuedAt: '2026-06-14T00:00:00Z', signalId: 'sig-1' },
      { msgId: 8, readCount: 2, enqueuedAt: null, signalId: 'sig-2' },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`${PROJECT_URL}/rest/v1/rpc/aios_read_signals`);
    expect(JSON.parse(init.body as string)).toEqual({ p_count: 5, p_vt: 30 });
  });

  it('slaat messages zonder signalId over', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { msg_id: 1, read_ct: 1, enqueued_at: null, message: {} },
        { msg_id: 2, read_ct: 1, enqueued_at: null, message: { signalId: 'sig-ok' } },
      ]),
    );
    const batch = await consumer().read();
    expect(batch).toHaveLength(1);
    expect(batch[0].signalId).toBe('sig-ok');
  });

  it('gebruikt defaults count=10 vt=60', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await consumer().read();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ p_count: 10, p_vt: 60 });
  });

  it('archiveert via aios_archive_signal en geeft de boolean door', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(true));
    const ok = await consumer().archive(42);
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`${PROJECT_URL}/rest/v1/rpc/aios_archive_signal`);
    expect(JSON.parse(init.body as string)).toEqual({ p_msg_id: 42 });
  });

  it('archive geeft false bij een niet-true respons', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false));
    expect(await consumer().archive(99)).toBe(false);
  });
});

describe('InMemorySignalConsumer', () => {
  it('enqueue → read → archive flow', async () => {
    const c = new InMemorySignalConsumer();
    const m1 = c.enqueue('sig-a');
    c.enqueue('sig-b');

    let batch = await c.read();
    expect(batch.map((m) => m.signalId)).toEqual(['sig-a', 'sig-b']);

    expect(await c.archive(m1)).toBe(true);
    expect(await c.archive(m1)).toBe(false); // dubbel archiveren = false

    batch = await c.read();
    expect(batch.map((m) => m.signalId)).toEqual(['sig-b']);
  });

  it('respecteert count', async () => {
    const c = new InMemorySignalConsumer();
    c.enqueue('a');
    c.enqueue('b');
    c.enqueue('c');
    expect(await c.read({ count: 2 })).toHaveLength(2);
  });
});
