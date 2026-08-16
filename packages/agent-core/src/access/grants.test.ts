import { describe, expect, it } from 'vitest';
import {
  ALL_MODULES,
  DEFAULT_ROLE_GRANTS,
  categoriesAcross,
  resolveAccess,
  toRoleGrant,
  type RoleGrant,
} from './grants.js';

const REGISTERED = ['klantenservice', 'sales', 'administratie'];

describe('resolveAccess — de gate van stap 2', () => {
  it('geeft een medewerkersrol nooit een financiële categorie', () => {
    const access = resolveAccess('reviewer', [...DEFAULT_ROLE_GRANTS]);
    for (const module of REGISTERED) {
      expect(access.categoriesIn(module)).toEqual(['operationeel']);
      expect(access.categoriesIn(module)).not.toContain('financieel');
      expect(access.categoriesIn(module)).not.toContain('commercieel');
    }
  });

  it('sluit de indirecte route ook af: er gaat geen zwaardere categorie de MCP in', () => {
    // De afgeleide waarde zelf wordt aan MCP-zijde tegengehouden — een marge
    // erft de categorie van zijn zwaarste bron en is dus financieel. Hier
    // bewaken we de andere helft van diezelfde grens: wat de cockpit meestuurt
    // bevat die categorie niet, dus er ís niets om een marge mee vrij te geven.
    const access = resolveAccess('reviewer', [...DEFAULT_ROLE_GRANTS]);
    const meegestuurd = categoriesAcross(access, REGISTERED);
    expect(meegestuurd).toEqual(['operationeel']);
  });

  it('geeft een directierol alles', () => {
    const access = resolveAccess('admin', [...DEFAULT_ROLE_GRANTS]);
    expect(access.categoriesIn('klantenservice')).toEqual([
      'operationeel',
      'commercieel',
      'financieel',
    ]);
  });
});

describe('resolveAccess — module-as', () => {
  const GRANTS: RoleGrant[] = [
    { role: 'reviewer', module: ALL_MODULES, categories: ['operationeel'] },
    { role: 'reviewer', module: 'sales', categories: ['operationeel', 'commercieel'] },
  ];

  it('laat een specifieke module de joker overrulen', () => {
    const access = resolveAccess('reviewer', GRANTS);
    expect(access.categoriesIn('sales')).toEqual(['operationeel', 'commercieel']);
    expect(access.categoriesIn('klantenservice')).toEqual(['operationeel']);
  });

  it('houdt een rol zonder joker buiten de modules die hij niet heeft', () => {
    const access = resolveAccess('reviewer', [
      { role: 'reviewer', module: 'sales', categories: ['operationeel'] },
    ]);
    expect(access.mayEnter('sales')).toBe(true);
    expect(access.mayEnter('administratie')).toBe(false);
    expect(access.modulesFrom(REGISTERED)).toEqual(['sales']);
  });

  it('geeft niets terug voor een module waar de rol niet in mag', () => {
    // Niet "operationeel als bodem": wie er niet hoort, hoort er ook geen
    // orderstatus uit te kunnen lezen.
    const access = resolveAccess('reviewer', [
      { role: 'reviewer', module: 'sales', categories: ['operationeel'] },
    ]);
    expect(access.categoriesIn('administratie')).toEqual([]);
  });

  it('kijkt niet naar de grants van een andere rol', () => {
    const access = resolveAccess('viewer', GRANTS);
    // Viewer heeft geen eigen rij → standaardvoorstel, niet die van reviewer.
    expect(access.categoriesIn('sales')).toEqual(['operationeel']);
  });
});

describe('resolveAccess — terugval', () => {
  it('valt op het standaardvoorstel terug als de tenant niets heeft ingesteld', () => {
    const access = resolveAccess('admin', []);
    expect(access.categoriesIn('klantenservice')).toEqual([
      'operationeel',
      'commercieel',
      'financieel',
    ]);
  });

  it('valt niet terug zodra de rol wél een rij heeft', () => {
    // Een tenant die admin bewust inperkt, moet dat kunnen — anders is de
    // terugval een achterdeur.
    const access = resolveAccess('admin', [
      { role: 'admin', module: ALL_MODULES, categories: ['operationeel'] },
    ]);
    expect(access.categoriesIn('klantenservice')).toEqual(['operationeel']);
  });
});

describe('categoriesAcross', () => {
  it('neemt de vereniging over de modules waar de rol in mag', () => {
    const access = resolveAccess('reviewer', [
      { role: 'reviewer', module: 'klantenservice', categories: ['operationeel'] },
      { role: 'reviewer', module: 'sales', categories: ['commercieel'] },
    ]);
    expect(categoriesAcross(access, REGISTERED)).toEqual([
      'operationeel',
      'commercieel',
    ]);
  });

  it('telt een module waar de rol niet in mag niet mee', () => {
    const access = resolveAccess('reviewer', [
      { role: 'reviewer', module: 'klantenservice', categories: ['operationeel'] },
    ]);
    expect(categoriesAcross(access, REGISTERED)).toEqual(['operationeel']);
  });
});

describe('toRoleGrant', () => {
  it('leest een geldige rij', () => {
    expect(
      toRoleGrant({ role: 'admin', module: '*', categories: ['financieel'] }),
    ).toEqual({ role: 'admin', module: '*', categories: ['financieel'] });
  });

  it('gooit een onbekende categorie weg in plaats van hem te vertrouwen', () => {
    expect(
      toRoleGrant({ role: 'reviewer', module: 'sales', categories: ['hr', 'operationeel'] }),
    ).toEqual({ role: 'reviewer', module: 'sales', categories: ['operationeel'] });
  });

  it('weigert een onbekende rol', () => {
    expect(toRoleGrant({ role: 'directie', module: '*', categories: [] })).toBeNull();
  });

  it('weigert een rij zonder module', () => {
    expect(toRoleGrant({ role: 'admin', module: '  ', categories: [] })).toBeNull();
  });

  it('normaliseert de volgorde zodat gelijke grants gelijk serialiseren', () => {
    const grant = toRoleGrant({
      role: 'admin',
      module: '*',
      categories: ['financieel', 'operationeel'],
    });
    expect(grant?.categories).toEqual(['operationeel', 'financieel']);
  });
});
