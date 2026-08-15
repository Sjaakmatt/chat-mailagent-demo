import { describe, it, expect } from 'vitest';
import {
  isOriginAllowed,
  evaluateRate,
  emptyRateState,
  parseVisitorMessage,
  readLimit,
  type ChatRateLimits,
} from './index.js';

const SELF = 'https://acme-mail-agent.workers.dev';

describe('isOriginAllowed', () => {
  it('laat zonder allowlist alleen de Worker zelf toe', () => {
    expect(isOriginAllowed(SELF, undefined, SELF)).toBe(true);
    expect(isOriginAllowed('https://kwaadwillend.nl', undefined, SELF)).toBe(false);
  });

  it('laat een expliciet toegestane origin toe', () => {
    const list = 'https://shop.acme.nl,https://www.acme.nl';
    expect(isOriginAllowed('https://shop.acme.nl', list, SELF)).toBe(true);
    expect(isOriginAllowed('https://www.acme.nl', list, SELF)).toBe(true);
    expect(isOriginAllowed('https://anders.nl', list, SELF)).toBe(false);
  });

  it('houdt de Worker zelf toegestaan naast een allowlist', () => {
    expect(isOriginAllowed(SELF, 'https://shop.acme.nl', SELF)).toBe(true);
  });

  it('negeert hoofdletters, spaties en een afsluitende slash', () => {
    const list = ' HTTPS://Shop.Acme.NL/ ';
    expect(isOriginAllowed('https://shop.acme.nl', list, SELF)).toBe(true);
  });

  it('weigert een ontbrekende Origin-header', () => {
    // Een browser stuurt 'm altijd mee; ontbreekt hij, dan is het geen browser.
    expect(isOriginAllowed(null, 'https://shop.acme.nl', SELF)).toBe(false);
    expect(isOriginAllowed(undefined, undefined, SELF)).toBe(false);
    expect(isOriginAllowed('', 'https://shop.acme.nl', SELF)).toBe(false);
  });

  it('laat alles toe bij een wildcard, ook zonder Origin', () => {
    expect(isOriginAllowed('https://wat-dan-ook.nl', '*', SELF)).toBe(true);
    expect(isOriginAllowed(null, '*', SELF)).toBe(true);
  });

  it('behandelt een lege allowlist als ongezet', () => {
    expect(isOriginAllowed('https://anders.nl', '   ,  ,', SELF)).toBe(false);
    expect(isOriginAllowed(SELF, '   ,  ,', SELF)).toBe(true);
  });
});

describe('evaluateRate', () => {
  const limits: ChatRateLimits = { perMinute: 3, perSession: 5 };
  const T0 = 1_000_000;

  it('laat berichten door tot de minuutgrens', () => {
    let state = emptyRateState(T0);
    for (let i = 1; i <= 3; i++) {
      const d = evaluateRate(state, T0, limits);
      expect(d.allowed).toBe(true);
      state = d.state;
      expect(state.inWindow).toBe(i);
      expect(state.total).toBe(i);
    }
  });

  it('blokkeert het vierde bericht binnen dezelfde minuut', () => {
    let state = emptyRateState(T0);
    for (let i = 0; i < 3; i++) state = evaluateRate(state, T0, limits).state;

    const d = evaluateRate(state, T0 + 10_000, limits);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe('per_minute');
      // Venster begon op T0, dus na 10s resteert 50s.
      expect(d.retryAfterMs).toBe(50_000);
    }
  });

  it('telt niet mee wat geblokkeerd is', () => {
    let state = emptyRateState(T0);
    for (let i = 0; i < 3; i++) state = evaluateRate(state, T0, limits).state;

    const geweigerd = evaluateRate(state, T0, limits);
    expect(geweigerd.state.total).toBe(3);
  });

  it('opent een nieuw venster na een minuut, met behoud van het sessietotaal', () => {
    let state = emptyRateState(T0);
    for (let i = 0; i < 3; i++) state = evaluateRate(state, T0, limits).state;

    const d = evaluateRate(state, T0 + 60_000, limits);
    expect(d.allowed).toBe(true);
    expect(d.state.inWindow).toBe(1);
    expect(d.state.total).toBe(4);
  });

  it('blokkeert definitief op de sessiegrens', () => {
    let state = emptyRateState(T0);
    // 5 berichten verspreid over vensters, zodat de minuutgrens niet stoort.
    for (let i = 0; i < 5; i++) {
      const d = evaluateRate(state, T0 + i * 60_000, limits);
      expect(d.allowed).toBe(true);
      state = d.state;
    }
    expect(state.total).toBe(5);

    const d = evaluateRate(state, T0 + 10 * 60_000, limits);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe('session_total');
      // Wachten heeft geen zin meer.
      expect(d.retryAfterMs).toBe(0);
    }
  });

  it('laat de sessiegrens vóór de minuutgrens gaan', () => {
    const krap: ChatRateLimits = { perMinute: 10, perSession: 2 };
    let state = emptyRateState(T0);
    state = evaluateRate(state, T0, krap).state;
    state = evaluateRate(state, T0, krap).state;

    const d = evaluateRate(state, T0, krap);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe('session_total');
  });
});

describe('parseVisitorMessage', () => {
  it('leest JSON met body en email', () => {
    const m = parseVisitorMessage('{"body":"Waar blijft mijn pakket?","email":"a@example.com"}', 100);
    expect(m).toEqual({ body: 'Waar blijft mijn pakket?', email: 'a@example.com' });
  });

  it('accepteert platte tekst', () => {
    expect(parseVisitorMessage('gewoon tekst', 100)).toEqual({ body: 'gewoon tekst' });
  });

  it('laat email weg als die er niet is', () => {
    const m = parseVisitorMessage('{"body":"hoi"}', 100);
    expect(m).toEqual({ body: 'hoi' });
    expect(m && 'email' in m).toBe(false);
  });

  it('geeft null bij leeg of alleen witruimte', () => {
    expect(parseVisitorMessage('', 100)).toBeNull();
    expect(parseVisitorMessage('    ', 100)).toBeNull();
    expect(parseVisitorMessage('{"body":"   "}', 100)).toBeNull();
  });

  it('weigert een te lang bericht in plaats van het af te kappen', () => {
    expect(parseVisitorMessage('x'.repeat(101), 100)).toBeNull();
    expect(parseVisitorMessage('x'.repeat(100), 100)).not.toBeNull();
  });

  it('meet de lengte ná trimmen', () => {
    expect(parseVisitorMessage(`   ${'x'.repeat(100)}   `, 100)).not.toBeNull();
  });

  it('negeert een niet-string body in JSON', () => {
    // Valt terug op de ruwe tekst, die dan als platte tekst wordt gelezen.
    expect(parseVisitorMessage('{"body":42}', 100)).toEqual({ body: '{"body":42}' });
  });
});

describe('readLimit', () => {
  it('leest een geldige waarde', () => {
    expect(readLimit('25', 10)).toBe(25);
    expect(readLimit(' 25 ', 10)).toBe(25);
  });

  it('valt terug bij ontbrekend of onzinnig', () => {
    expect(readLimit(undefined, 10)).toBe(10);
    expect(readLimit('', 10)).toBe(10);
    expect(readLimit('geen getal', 10)).toBe(10);
  });

  it('valt terug bij nul of negatief — nooit "geen limiet"', () => {
    expect(readLimit('0', 10)).toBe(10);
    expect(readLimit('-5', 10)).toBe(10);
  });
});
