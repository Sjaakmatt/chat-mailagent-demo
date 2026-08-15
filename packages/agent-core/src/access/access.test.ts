import { describe, it, expect } from 'vitest';
import {
  domainRuleFor,
  isDomainRule,
  allowlistKeysFor,
  resolveRoleFromRows,
  isValidAllowlistEntry,
  normalizeEmail,
} from './index.js';

describe('domainRuleFor', () => {
  it('haalt het domein uit een adres', () => {
    expect(domainRuleFor('jan@klant.nl')).toBe('@klant.nl');
  });

  it('normaliseert hoofdletters en spaties', () => {
    expect(domainRuleFor('  Jan@Klant.NL ')).toBe('@klant.nl');
  });

  it('neemt het laatste apenstaartje', () => {
    expect(domainRuleFor('a@b@klant.nl')).toBe('@klant.nl');
  });

  it('geeft null zonder apenstaartje', () => {
    expect(domainRuleFor('jan')).toBeNull();
  });

  it('geeft null als er niets vóór of ná het apenstaartje staat', () => {
    expect(domainRuleFor('@klant.nl')).toBeNull();
    expect(domainRuleFor('jan@')).toBeNull();
  });

  it('geeft null bij een domein zonder punt — dat sluit ook "@" alleen uit', () => {
    expect(domainRuleFor('jan@localhost')).toBeNull();
    expect(domainRuleFor('@')).toBeNull();
  });
});

describe('resolveRoleFromRows', () => {
  it('matcht een persoonlijk adres', () => {
    const rows = [{ email: 'jan@klant.nl', role: 'admin' }];
    expect(resolveRoleFromRows('jan@klant.nl', rows)).toBe('admin');
  });

  it('matcht via een domeinregel', () => {
    const rows = [{ email: '@klant.nl', role: 'reviewer' }];
    expect(resolveRoleFromRows('wie.dan.ook@klant.nl', rows)).toBe('reviewer');
  });

  it('laat de persoonlijke regel winnen van de domeinregel', () => {
    const rows = [
      { email: '@klant.nl', role: 'reviewer' },
      { email: 'jan@klant.nl', role: 'admin' },
    ];
    expect(resolveRoleFromRows('jan@klant.nl', rows)).toBe('admin');
  });

  it('kan iemand met een persoonlijke regel terugschroeven', () => {
    const rows = [
      { email: '@klant.nl', role: 'admin' },
      { email: 'stagiair@klant.nl', role: 'viewer' },
    ];
    expect(resolveRoleFromRows('stagiair@klant.nl', rows)).toBe('viewer');
  });

  it('geeft null als er niets matcht', () => {
    const rows = [{ email: '@klant.nl', role: 'admin' }];
    expect(resolveRoleFromRows('jan@ander.nl', rows)).toBeNull();
  });

  it('matcht het domein exact — géén suffix-match', () => {
    const rows = [{ email: '@klant.nl', role: 'admin' }];
    // Zou binnenglippen bij een endsWith-vergelijking.
    expect(resolveRoleFromRows('aanvaller@nietklant.nl', rows)).toBeNull();
    expect(resolveRoleFromRows('aanvaller@klant.nl.aanvaller.com', rows)).toBeNull();
  });

  it('laat een lege allowlist niemand binnen', () => {
    expect(resolveRoleFromRows('jan@klant.nl', [])).toBeNull();
  });

  it('valt terug op reviewer bij een onbekende rol — nooit op admin', () => {
    const rows = [{ email: 'jan@klant.nl', role: 'superuser' }];
    expect(resolveRoleFromRows('jan@klant.nl', rows)).toBe('reviewer');
    expect(resolveRoleFromRows('jan@klant.nl', [{ email: 'jan@klant.nl', role: null }])).toBe(
      'reviewer',
    );
  });

  it('vergelijkt hoofdletterongevoelig', () => {
    const rows = [{ email: '@Klant.NL', role: 'admin' }];
    expect(resolveRoleFromRows('JAN@KLANT.nl', rows)).toBe('admin');
  });
});

describe('allowlistKeysFor', () => {
  it('geeft adres én domeinregel', () => {
    expect(allowlistKeysFor('jan@klant.nl')).toEqual(['jan@klant.nl', '@klant.nl']);
  });

  it('geeft alleen het adres als er geen bruikbaar domein is', () => {
    expect(allowlistKeysFor('jan')).toEqual(['jan']);
  });
});

describe('isValidAllowlistEntry', () => {
  it('accepteert een adres en een domeinregel', () => {
    expect(isValidAllowlistEntry('jan@klant.nl')).toBe(true);
    expect(isValidAllowlistEntry('@klant.nl')).toBe(true);
  });

  it('weigert een kale apenstaart — die zou iedereen binnenlaten', () => {
    expect(isValidAllowlistEntry('@')).toBe(false);
    expect(isValidAllowlistEntry('')).toBe(false);
  });

  it('weigert vormen zonder punt in het domein of met spaties', () => {
    expect(isValidAllowlistEntry('jan@localhost')).toBe(false);
    expect(isValidAllowlistEntry('jan @klant.nl')).toBe(false);
  });
});

describe('isDomainRule / normalizeEmail', () => {
  it('herkent een domeinregel', () => {
    expect(isDomainRule('@klant.nl')).toBe(true);
    expect(isDomainRule('jan@klant.nl')).toBe(false);
  });

  it('normaliseert', () => {
    expect(normalizeEmail('  Jan@Klant.NL ')).toBe('jan@klant.nl');
  });
});
