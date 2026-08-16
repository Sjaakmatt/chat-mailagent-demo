import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signCustomerId, verifyChatIdentity, customerSessionId } from './index.js';

const GEHEIM = 'test-geheim-dat-nooit-in-de-browser-komt';

describe('signCustomerId', () => {
  it('geeft sha256-hex van 64 tekens', async () => {
    const h = await signCustomerId('123', GEHEIM);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministisch', async () => {
    expect(await signCustomerId('123', GEHEIM)).toBe(await signCustomerId('123', GEHEIM));
  });

  it('verschilt per klant en per geheim', async () => {
    const a = await signCustomerId('123', GEHEIM);
    expect(await signCustomerId('124', GEHEIM)).not.toBe(a);
    expect(await signCustomerId('123', 'ander-geheim')).not.toBe(a);
  });

  // De winkelkant rekent dit uit in PHP, Ruby of Node. Vergelijken met een
  // onafhankelijke implementatie legt vast dat wij exact hetzelfde doen als
  // `hash_hmac('sha256', $klantId, $geheim)` — de integratie staat of valt
  // daarmee, en een magische constante in een test bewijst dat niet.
  it('komt overeen met een onafhankelijke HMAC-SHA256-implementatie', async () => {
    for (const id of ['123', 'jan@voorbeeld.nl', 'a-b-c-42', 'ünïcode']) {
      const referentie = createHmac('sha256', GEHEIM).update(id, 'utf8').digest('hex');
      expect(await signCustomerId(id, GEHEIM)).toBe(referentie);
    }
  });
});

describe('verifyChatIdentity', () => {
  it('accepteert een geldige handtekening', async () => {
    const hash = await signCustomerId('klant-9', GEHEIM);
    const uit = await verifyChatIdentity({ customerId: 'klant-9', hash }, GEHEIM);
    expect(uit).toEqual({ verified: true, customerId: 'klant-9', reason: 'geverifieerd' });
  });

  // De kern: zonder het geheim kun je geen geldige claim verzinnen.
  it('weigert een ander klant-id met dezelfde handtekening', async () => {
    const hash = await signCustomerId('klant-9', GEHEIM);
    const uit = await verifyChatIdentity({ customerId: 'klant-10', hash }, GEHEIM);
    expect(uit.verified).toBe(false);
    expect(uit.customerId).toBeUndefined();
  });

  it('weigert een verzonnen handtekening', async () => {
    const uit = await verifyChatIdentity({ customerId: 'klant-9', hash: 'a'.repeat(64) }, GEHEIM);
    expect(uit.verified).toBe(false);
  });

  it('weigert een handtekening met het verkeerde geheim', async () => {
    const hash = await signCustomerId('klant-9', 'geheim-van-een-andere-winkel');
    expect((await verifyChatIdentity({ customerId: 'klant-9', hash }, GEHEIM)).verified).toBe(false);
  });

  it('is hoofdletterongevoelig op de hex', async () => {
    const hash = await signCustomerId('klant-9', GEHEIM);
    const uit = await verifyChatIdentity({ customerId: 'klant-9', hash: hash.toUpperCase() }, GEHEIM);
    expect(uit.verified).toBe(true);
  });

  // Geen fout maar anoniem: een half ingerichte winkel houdt een werkende chat.
  it('valt terug op anoniem zonder claim', async () => {
    const uit = await verifyChatIdentity({}, GEHEIM);
    expect(uit).toEqual({ verified: false, reason: 'anoniem' });
  });

  it('negeert een claim als het geheim ontbreekt, en zegt waarom', async () => {
    const uit = await verifyChatIdentity({ customerId: '1', hash: 'a'.repeat(64) }, undefined);
    expect(uit.verified).toBe(false);
    expect(uit.reason).toContain('CHAT_IDENTITY_SECRET');
  });

  it('weigert een halve claim', async () => {
    expect((await verifyChatIdentity({ customerId: '1' }, GEHEIM)).verified).toBe(false);
    expect((await verifyChatIdentity({ hash: 'a'.repeat(64) }, GEHEIM)).verified).toBe(false);
  });

  it('weigert iets dat niet op een hash lijkt', async () => {
    const uit = await verifyChatIdentity({ customerId: '1', hash: 'niet-hex' }, GEHEIM);
    expect(uit.reason).toContain('sha256-hex');
  });
});

describe('customerSessionId', () => {
  it('is deterministisch — daar draait het om', async () => {
    expect(await customerSessionId('klant-9', GEHEIM)).toBe(
      await customerSessionId('klant-9', GEHEIM),
    );
  });

  it('verschilt per klant', async () => {
    expect(await customerSessionId('klant-9', GEHEIM)).not.toBe(
      await customerSessionId('klant-10', GEHEIM),
    );
  });

  // Het klant-id hoort niet in een URL of een logregel te belanden.
  it('bevat het klant-id niet', async () => {
    const id = await customerSessionId('jan@voorbeeld.nl', GEHEIM);
    expect(id).not.toContain('jan');
    expect(id).toMatch(/^u-[0-9a-f]{32}$/);
  });

  // Anders zou een gelekte inlog-hash meteen de sessienaam opleveren.
  it('is niet gelijk aan de inlog-handtekening', async () => {
    expect(await customerSessionId('klant-9', GEHEIM)).not.toContain(
      await signCustomerId('klant-9', GEHEIM),
    );
  });
});
