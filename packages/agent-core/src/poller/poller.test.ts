import { describe, it, expect, vi } from 'vitest';
import { InMemorySignalConsumer } from '../signals/index.js';
import { runPoll, nextPollDelayMs } from './index.js';

describe('runPoll (de seam)', () => {
  it('start per message met idempotency-key = msgId en archiveert ná succes', async () => {
    const consumer = new InMemorySignalConsumer();
    const m1 = consumer.enqueue('sig-a');
    const m2 = consumer.enqueue('sig-b');
    const start = vi.fn().mockResolvedValue(undefined);

    const res = await runPoll(consumer, start, { count: 10 });

    expect(res).toMatchObject({ read: 2, started: 2, archived: 2, failures: 0 });
    expect(start).toHaveBeenCalledWith({ msgId: m1, signalId: 'sig-a', idempotencyKey: String(m1) });
    expect(start).toHaveBeenCalledWith({ msgId: m2, signalId: 'sig-b', idempotencyKey: String(m2) });
    expect(consumer.archived).toEqual([m1, m2]);
  });

  it('archiveert NIET wanneer de Workflow-start faalt (message komt terug)', async () => {
    const consumer = new InMemorySignalConsumer();
    const m1 = consumer.enqueue('sig-a');
    const start = vi.fn().mockRejectedValue(new Error('workflow down'));

    const res = await runPoll(consumer, start);

    expect(res).toMatchObject({ read: 1, started: 0, archived: 0, failures: 1 });
    expect(consumer.archived).toEqual([]);
  });

  it('verwerkt overige messages ook als er één faalt', async () => {
    const consumer = new InMemorySignalConsumer();
    consumer.enqueue('sig-a');
    const m2 = consumer.enqueue('sig-b');
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    const res = await runPoll(consumer, start);

    expect(res).toMatchObject({ read: 2, started: 1, archived: 1, failures: 1 });
    expect(consumer.archived).toEqual([m2]);
  });
});

describe('nextPollDelayMs (back-off)', () => {
  const opts = { minMs: 1000, maxMs: 30000 };

  it('reset naar minMs zodra er werk was', () => {
    expect(nextPollDelayMs({ read: 3, started: 3, archived: 3, failures: 0 }, 8000, opts)).toBe(1000);
  });

  it('groeit exponentieel bij een lege queue', () => {
    expect(nextPollDelayMs({ read: 0, started: 0, archived: 0, failures: 0 }, 1000, opts)).toBe(2000);
    expect(nextPollDelayMs({ read: 0, started: 0, archived: 0, failures: 0 }, 4000, opts)).toBe(8000);
  });

  it('plafonneert op maxMs', () => {
    expect(nextPollDelayMs({ read: 0, started: 0, archived: 0, failures: 0 }, 20000, opts)).toBe(30000);
  });
});
