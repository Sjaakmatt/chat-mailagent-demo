import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlatformStore } from './store.js';
import type { Env } from './env.js';

/**
 * Het afsluiten van een ReviewItem dat de agent zélf heeft afgehandeld.
 *
 * De aanleiding: elke chatbeurt liet een PENDING-concept achter in de werkbak,
 * terwijl het antwoord al bij de bezoeker lag. De teller "concepten wachten op
 * review" liep dus op met precies díe vragen die de agent juist zonder mens had
 * afgedaan.
 *
 * Twee dingen liggen hier vast, en allebei om een reden die je in de code zelf
 * niet ziet: de PATCH is beperkt tot `status=PENDING`, zodat een oordeel dat een
 * mens intussen heeft geveld niet wordt overschreven, en `decided_by` is geen
 * mailadres maar `agent` — anders staat er in de auditlog een beslisser die
 * nooit op een knop heeft gedrukt.
 */

const env = {
  AIOS_SUPABASE_URL: 'https://demo.supabase.co',
  AIOS_SUPABASE_SERVICE_ROLE_KEY: 'service-role',
} as unknown as Env;

let calls: { url: string; method?: string; body?: string }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init: { method?: string; body?: string } = {}) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      // 200 met een lege body; `Response` weigert een body bij 204, en met
      // `return=minimal` maakt de inhoud hier toch niet uit.
      return new Response('', { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('markReviewItemHandled', () => {
  it('sluit het item af als EXECUTED, met de agent als beslisser', async () => {
    await createPlatformStore(env).markReviewItemHandled('ri_1', 'agent');

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe('PATCH');

    const body = JSON.parse(call.body ?? '{}');
    expect(body.status).toBe('EXECUTED');
    expect(body.decided_by).toBe('agent');
    // Beide stempels, anders valt het item uit de audittijdlijn óf uit de
    // "afgerond"-telling.
    expect(body.decided_at).toEqual(expect.any(String));
    expect(body.executed_at).toEqual(expect.any(String));
  });

  it('raakt alleen dit item, en alleen zolang het nog PENDING staat', async () => {
    await createPlatformStore(env).markReviewItemHandled('ri_1', 'agent');

    const url = new URL(calls[0].url);
    expect(url.pathname).toContain('aios_review_items');
    expect(url.searchParams.get('id')).toBe('eq.ri_1');
    // Dit is de hele bescherming: heeft een medewerker het item intussen
    // afgekeurd, dan matcht de PATCH niets en blijft dat oordeel staan.
    expect(url.searchParams.get('status')).toBe('eq.PENDING');
  });
});
