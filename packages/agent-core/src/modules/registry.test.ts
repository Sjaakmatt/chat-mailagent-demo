import { describe, expect, it } from 'vitest';
import {
  MODULE_PACKS,
  actionTypeBySlug,
  assertRegistry,
  packById,
  packForActionType,
  resolveModule,
} from './registry.js';
import { claimMatches, type ModulePack, type SignalClaim } from './contract.js';
import type { Signal } from '../contracts/index.js';

function signaal(over: Partial<Signal> = {}): Signal {
  return {
    id: 'sig_1',
    organizationId: 'org_demo',
    domain: 'mail',
    type: 'mail.received',
    payload: {},
    status: 'NEW',
    receivedAt: '2026-01-01T09:00:00.000Z',
    ...over,
  };
}

describe('claims', () => {
  const claim = (over: Partial<SignalClaim> = {}): SignalClaim => ({
    domain: 'mail',
    ...over,
  });

  it('matcht op domein en type', () => {
    expect(claimMatches(claim({ type: 'mail.received' }), signaal())).toBe(true);
    expect(claimMatches(claim({ type: 'mail.sent' }), signaal())).toBe(false);
  });

  it('pakt het hele domein als er geen type staat', () => {
    expect(claimMatches(claim(), signaal({ type: 'mail.wat.dan.ook' }))).toBe(true);
  });

  it('matcht nooit buiten zijn domein', () => {
    expect(claimMatches(claim(), signaal({ domain: 'bank' }))).toBe(false);
  });

  it('laat een predicaat de laatste zeef zijn', () => {
    // De reden dat `when` bestaat: administratie en klantenservice krijgen
    // straks allebei `mail.received`, en dan beslist de inhoud.
    const alleenFacturen = claim({
      type: 'mail.received',
      when: (s) => String((s.payload as { subject?: string }).subject ?? '').includes('factuur'),
    });
    expect(claimMatches(alleenFacturen, signaal({ payload: { subject: 'uw factuur' } }))).toBe(true);
    expect(claimMatches(alleenFacturen, signaal({ payload: { subject: 'waar blijft het' } }))).toBe(
      false,
    );
  });
});

describe('resolveModule', () => {
  it('vindt de module die dit signaal claimt', () => {
    expect(resolveModule(signaal())?.descriptor.id).toBe('klantenservice');
  });

  it('geeft null als niemand het claimt', () => {
    // Expliciet en geen terugval op de eerste module: een bankmutatie door de
    // poort van de klantenservice sturen levert een net geformuleerd "daar ga
    // ik niet over" op iets waar wél iemand naar had moeten kijken.
    expect(resolveModule(signaal({ domain: 'bank', type: 'payment.in' }))).toBeNull();
  });
});

describe('lookups', () => {
  it('vindt een pakket op id', () => {
    expect(packById('klantenservice')?.descriptor.id).toBe('klantenservice');
  });

  it('geeft null bij een onbekend of leeg id', () => {
    expect(packById('bestaat_niet')).toBeNull();
    expect(packById(null)).toBeNull();
  });

  it('vindt een actietype en zijn module over de registry heen', () => {
    // Een opgeslagen voorstel draagt alleen de slug; zonder deze lookup is bij
    // het goedkeuren niet te achterhalen wat het type inhoudt.
    const slug = MODULE_PACKS[0]!.actions[0]!.slug;
    expect(actionTypeBySlug(slug)?.slug).toBe(slug);
    expect(packForActionType(slug)?.descriptor.id).toBe(MODULE_PACKS[0]!.descriptor.id);
  });

  it('geeft null bij een actietype dat niemand meer kent', () => {
    expect(actionTypeBySlug('raket_lanceren')).toBeNull();
    expect(packForActionType('raket_lanceren')).toBeNull();
  });
});

describe('assertRegistry', () => {
  it('keurt de geregistreerde modules goed', () => {
    expect(assertRegistry()).toEqual([]);
  });

  it('meldt een dubbele module', () => {
    const pack = MODULE_PACKS[0]!;
    expect(assertRegistry([pack, pack]).join(' ')).toContain('twee keer');
  });

  it('meldt een actie-slug die in twee modules bestaat', () => {
    // Waarom dit een fout is: `aios_proposed_actions.type` draagt alleen de
    // slug. Twee modules met dezelfde slug zijn bij het goedkeuren niet uit
    // elkaar te houden, en dan keurt iemand de verkeerde operatie goed.
    const eerste = MODULE_PACKS[0]!;
    const tweede: ModulePack = {
      ...eerste,
      descriptor: { ...eerste.descriptor, id: 'administratie' },
    };
    expect(assertRegistry([eerste, tweede]).join(' ')).toContain('uniek over modules heen');
  });

  it('meldt een categorie die naar een onbekende specialist wijst', () => {
    const eerste = MODULE_PACKS[0]!;
    const scheef: ModulePack = {
      ...eerste,
      actions: [],
      taxonomy: [{ slug: 'iets', label: 'Iets', specialist: 'bestaat_niet' }],
    };
    expect(assertRegistry([scheef]).join(' ')).toContain('die deze module niet heeft');
  });

  it('meldt een pakket zonder specialisten of categorieën', () => {
    const leeg: ModulePack = {
      ...MODULE_PACKS[0]!,
      actions: [],
      specialists: [],
      taxonomy: [],
    };
    const fouten = assertRegistry([leeg]).join(' ');
    expect(fouten).toContain('geen specialisten');
    expect(fouten).toContain('geen categorieën');
  });
});
