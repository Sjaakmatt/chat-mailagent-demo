import { describe, expect, it } from 'vitest';
import {
  automationByName,
  isDue,
  parseSchedule,
  pollIdempotencyKey,
  rowsAfterCursor,
  scheduleIdempotencyKey,
  scheduleSignalType,
  slotFor,
  type ModuleTriggers,
  type ScheduledAutomation,
} from './index.js';

describe('parseSchedule', () => {
  it('leest de drie vormen', () => {
    expect(parseSchedule('hourly')).toEqual({ soort: 'hourly' });
    expect(parseSchedule('daily@08:30')).toEqual({ soort: 'daily', uur: 8, minuut: 30 });
    expect(parseSchedule('every:15m')).toEqual({ soort: 'every', minuten: 15 });
    expect(parseSchedule('every:6h')).toEqual({ soort: 'every', minuten: 360 });
  });

  it('is ongevoelig voor hoofdletters en spaties', () => {
    expect(parseSchedule('  DAILY@08:30 ')).toEqual({ soort: 'daily', uur: 8, minuut: 30 });
  });

  it('geeft null bij een onleesbaar rooster', () => {
    // Null en geen terugval op "elk uur": een automatisering met een kapot
    // rooster hoort stil te staan met een melding, niet een ander ritme te
    // krijgen dan er staat.
    for (const kapot of ['', null, undefined, '0 8 * * *', 'daily@25:00', 'daily@08:60', 'elke dag']) {
      expect(parseSchedule(kapot), String(kapot)).toBeNull();
    }
  });

  it('weigert een interval buiten de grenzen', () => {
    expect(parseSchedule('every:1m')).toBeNull();
    expect(parseSchedule('every:25h')).toBeNull();
    expect(parseSchedule('every:5m')).toEqual({ soort: 'every', minuten: 5 });
  });
});

describe('slotFor', () => {
  const nu = new Date('2026-08-21T08:37:12.000Z');

  it('geeft per soort de juiste korrel', () => {
    expect(slotFor({ soort: 'hourly' }, nu)).toBe('2026-08-21T08');
    expect(slotFor({ soort: 'daily', uur: 8, minuut: 0 }, nu)).toBe('2026-08-21');
    // 08:37 valt in het venster dat om 08:30 begon → 517 minuten na
    // middernacht, afgerond op 15.
    expect(slotFor({ soort: 'every', minuten: 15 }, nu)).toBe('2026-08-21T0510');
  });

  it('houdt twee momenten in dezelfde sleuf gelijk', () => {
    // Dit is waar de ontdubbeling op leunt: dezelfde sleuf, dezelfde sleutel.
    const later = new Date('2026-08-21T08:59:59.000Z');
    expect(slotFor({ soort: 'hourly' }, nu)).toBe(slotFor({ soort: 'hourly' }, later));
  });

  it('verspringt bij een nieuwe sleuf', () => {
    const volgendUur = new Date('2026-08-21T09:00:00.000Z');
    expect(slotFor({ soort: 'hourly' }, nu)).not.toBe(
      slotFor({ soort: 'hourly' }, volgendUur),
    );
  });
});

describe('isDue', () => {
  it('laat een nooit-gedraaide automatisering meteen draaien', () => {
    expect(isDue({ soort: 'hourly' }, new Date('2026-08-21T08:00:00Z'), null)).toBe(true);
  });

  it('draait niet twee keer in dezelfde sleuf', () => {
    const schedule = { soort: 'hourly' } as const;
    const nu = new Date('2026-08-21T08:45:00Z');
    expect(isDue(schedule, nu, '2026-08-21T08:05:00Z')).toBe(false);
  });

  it('draait weer in de volgende sleuf', () => {
    const schedule = { soort: 'hourly' } as const;
    expect(isDue(schedule, new Date('2026-08-21T09:01:00Z'), '2026-08-21T08:05:00Z')).toBe(
      true,
    );
  });

  it('wacht bij een dagtaak tot het tijdstip geweest is', () => {
    // Zonder deze check zou de eerste tik na middernacht de taak van 08:30 al
    // om 00:05 draaien.
    const schedule = { soort: 'daily', uur: 8, minuut: 30 } as const;
    expect(isDue(schedule, new Date('2026-08-21T00:05:00Z'), null)).toBe(false);
    expect(isDue(schedule, new Date('2026-08-21T08:29:00Z'), null)).toBe(false);
    expect(isDue(schedule, new Date('2026-08-21T08:31:00Z'), null)).toBe(true);
  });

  it('draait een dagtaak maar één keer per dag', () => {
    const schedule = { soort: 'daily', uur: 8, minuut: 30 } as const;
    expect(isDue(schedule, new Date('2026-08-21T14:00:00Z'), '2026-08-21T08:31:00Z')).toBe(
      false,
    );
    expect(isDue(schedule, new Date('2026-08-22T08:31:00Z'), '2026-08-21T08:31:00Z')).toBe(
      true,
    );
  });

  it('behandelt een onleesbare last_run_at als nooit gedraaid', () => {
    expect(isDue({ soort: 'hourly' }, new Date('2026-08-21T08:00:00Z'), 'ooit')).toBe(true);
  });
});

describe('idempotency-sleutels', () => {
  it('zet de tijdsleuf in de sleutel van een geplande run', () => {
    expect(scheduleIdempotencyKey({ name: 'ticket_opvolging', slot: '2026-08-21' })).toBe(
      'auto:ticket_opvolging:2026-08-21',
    );
  });

  it('onderscheidt meerdere signalen uit dezelfde tik', () => {
    const a = scheduleIdempotencyKey({ name: 'x', slot: '2026-08-21', key: 'TIC-1' });
    const b = scheduleIdempotencyKey({ name: 'x', slot: '2026-08-21', key: 'TIC-2' });
    expect(a).not.toBe(b);
  });

  it('geeft het signaaltype van een automatisering', () => {
    expect(scheduleSignalType('ticket_opvolging')).toBe('schedule.ticket_opvolging');
  });

  it('dedupliceert een poll op zijn cursorwaarde', () => {
    const sleutel = pollIdempotencyKey({
      module: 'administratie',
      source: 'openstaande_posten',
      cursor: '2026-08-21T08:00:00Z',
    });
    expect(sleutel).toBe('poll:administratie:openstaande_posten:2026-08-21T08:00:00Z');
  });
});

describe('rowsAfterCursor', () => {
  const rijen = [
    { id: 'a', updatedAt: '2026-08-21T08:00:00Z' },
    { id: 'b', updatedAt: '2026-08-21T09:00:00Z' },
    { id: 'c', updatedAt: '2026-08-21T10:00:00Z' },
  ];

  it('neemt bij een lege cursor alles mee', () => {
    const res = rowsAfterCursor(rijen, 'updatedAt', null);
    expect(res.rijen).toHaveLength(3);
    expect(res.nieuweCursor).toBe('2026-08-21T10:00:00Z');
  });

  it('neemt alleen wat na de cursor komt', () => {
    const res = rowsAfterCursor(rijen, 'updatedAt', '2026-08-21T09:00:00Z');
    expect(res.rijen.map((r) => r.id)).toEqual(['c']);
    expect(res.nieuweCursor).toBe('2026-08-21T10:00:00Z');
  });

  it('laat de cursor staan als er niets nieuws is', () => {
    const res = rowsAfterCursor(rijen, 'updatedAt', '2026-08-21T10:00:00Z');
    expect(res.rijen).toEqual([]);
    expect(res.nieuweCursor).toBe('2026-08-21T10:00:00Z');
  });

  it('slaat rijen zonder bruikbare cursorwaarde over', () => {
    // Die zouden de cursor niet vooruit kunnen zetten en dus elke ronde
    // opnieuw langskomen.
    const res = rowsAfterCursor([{ id: 'x' }, { id: 'y', updatedAt: '' }], 'updatedAt', null);
    expect(res.rijen).toEqual([]);
    expect(res.nieuweCursor).toBeNull();
  });
});

describe('automationByName', () => {
  const automatisering: ScheduledAutomation = {
    name: 'ticket_opvolging',
    description: 'test',
    async expand() {
      return [];
    },
  };
  const triggers: ModuleTriggers[] = [{ automations: [automatisering] }, {}];

  it('vindt een automatisering over de modules heen', () => {
    expect(automationByName(triggers, 'ticket_opvolging')).toBe(automatisering);
  });

  it('geeft null als geen enkele module hem kent', () => {
    expect(automationByName(triggers, 'bestaat_niet')).toBeNull();
  });
});
