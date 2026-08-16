import { describe, expect, it } from 'vitest';
import {
  ALL_MODULES,
  DEFAULT_ROLE_GRANTS,
  licensedFrom,
  mayAssignModule,
  parseModuleSet,
  resolveAccess,
  resolveUserAccess,
  type RoleGrant,
} from './index.js';

const REGISTERED = ['klantenservice', 'sales', 'administratie'];

/** Een klant die alleen klantenservice heeft afgenomen. */
const AFNAME_KS = ['klantenservice'];

const GRANTS: RoleGrant[] = [
  { role: 'reviewer', module: ALL_MODULES, categories: ['operationeel'] },
  { role: 'admin', module: ALL_MODULES, categories: ['operationeel', 'commercieel', 'financieel'] },
];

function access(opts: {
  role: 'admin' | 'reviewer' | 'viewer';
  licensed: readonly string[] | typeof ALL_MODULES;
  userModules: readonly string[] | typeof ALL_MODULES;
  grants?: RoleGrant[];
}) {
  const grants = opts.grants ?? GRANTS;
  return resolveUserAccess(
    { role: opts.role, grants, licensed: opts.licensed, userModules: opts.userModules },
    resolveAccess(opts.role, grants),
  );
}

describe('afname is het plafond', () => {
  it('houdt een beheerder van de klant binnen wat zijn organisatie heeft gekocht', () => {
    // Dit is de commerciële grens: wij verkopen per afdeling. Een beheerder bij
    // de klant is een tenant-beheerder, geen super admin.
    const me = access({ role: 'admin', licensed: AFNAME_KS, userModules: ALL_MODULES });
    expect(me.mayEnter('klantenservice')).toBe(true);
    expect(me.mayEnter('sales')).toBe(false);
    expect(me.mayEnter('administratie')).toBe(false);
  });

  it('laat de joker van de gebruiker nooit verder reiken dan de afname', () => {
    const me = access({ role: 'admin', licensed: AFNAME_KS, userModules: ALL_MODULES });
    expect(me.modulesFrom(REGISTERED)).toEqual(['klantenservice']);
  });

  it('geeft geen categorieën in een module buiten de afname', () => {
    // Niet "operationeel als bodem": buiten de afname is er niets, ook geen
    // orderstatus.
    const me = access({ role: 'admin', licensed: AFNAME_KS, userModules: ALL_MODULES });
    expect(me.categoriesIn('sales')).toEqual([]);
  });

  it('laat een rolgrant een module buiten de afname niet openzetten', () => {
    const me = access({
      role: 'reviewer',
      licensed: AFNAME_KS,
      userModules: ALL_MODULES,
      grants: [{ role: 'reviewer', module: 'sales', categories: ['financieel'] }],
    });
    expect(me.mayEnter('sales')).toBe(false);
    expect(me.categoriesIn('sales')).toEqual([]);
  });

  it('geeft niemand iets bij een lege afname', () => {
    const me = access({ role: 'admin', licensed: [], userModules: ALL_MODULES });
    expect(me.modulesFrom(REGISTERED)).toEqual([]);
  });
});

describe('toewijzing per gebruiker', () => {
  const licensed = ['klantenservice', 'sales', 'administratie'];

  it('scheidt twee medewerkers met dezelfde rol', () => {
    // Dit was het gat: twee reviewers zagen hetzelfde omdat de grant per rol
    // gaat. De toewijzing per gebruiker maakt ze uit elkaar te houden.
    const jan = access({ role: 'reviewer', licensed, userModules: ['klantenservice'] });
    const ans = access({ role: 'reviewer', licensed, userModules: ['sales'] });

    expect(jan.modulesFrom(REGISTERED)).toEqual(['klantenservice']);
    expect(ans.modulesFrom(REGISTERED)).toEqual(['sales']);
  });

  it('laat iemand in meer dan één afdeling werken zonder tweede account', () => {
    const ans = access({ role: 'reviewer', licensed, userModules: ['sales', 'administratie'] });
    expect(ans.modulesFrom(REGISTERED)).toEqual(['sales', 'administratie']);
  });

  it('houdt de rang los van de afdeling', () => {
    // Een kijker in sales blijft een kijker; de afdeling zegt niets over rang.
    const kijker = access({ role: 'viewer', licensed, userModules: ['sales'] });
    expect(kijker.mayEnter('sales')).toBe(true);
    expect(kijker.categoriesIn('sales')).toEqual(['operationeel']);
  });

  it('geeft een gebruiker zonder toegewezen module nergens toegang', () => {
    const niemand = access({ role: 'admin', licensed, userModules: [] });
    expect(niemand.modulesFrom(REGISTERED)).toEqual([]);
  });
});

describe('parseModuleSet', () => {
  it('leest een komma-gescheiden config-string', () => {
    expect(parseModuleSet('klantenservice, sales')).toEqual(['klantenservice', 'sales']);
  });

  it('leest een database-array', () => {
    expect(parseModuleSet(['sales'])).toEqual(['sales']);
  });

  it('herkent de joker, ook tussen andere waarden', () => {
    expect(parseModuleSet('klantenservice,*')).toBe(ALL_MODULES);
    expect(parseModuleSet(['*'])).toBe(ALL_MODULES);
  });

  it('is fail-closed op leeg: geen afname is geen toegang', () => {
    // Anders dan bij de rollen. Een ontbrekende afname is geen storing die je
    // wilt overbruggen — het is een klant die niets heeft gekocht.
    expect(parseModuleSet(undefined)).toEqual([]);
    expect(parseModuleSet('')).toEqual([]);
    expect(parseModuleSet('  ,  ')).toEqual([]);
  });

  it('ontdubbelt', () => {
    expect(parseModuleSet('sales,sales')).toEqual(['sales']);
  });
});

describe('licensedFrom', () => {
  it('snijdt de registratie op de afname', () => {
    expect(licensedFrom(AFNAME_KS, REGISTERED)).toEqual(['klantenservice']);
  });

  it('geeft bij de joker alles wat geregistreerd is', () => {
    expect(licensedFrom(ALL_MODULES, REGISTERED)).toEqual(REGISTERED);
  });

  it('noemt een afgenomen module die nog geen code heeft niet', () => {
    // Registratie zegt dat er code is, afname dat het mag. Een afgenomen maar
    // ongeregistreerde module is wel toewijsbaar (zie mayAssignModule) maar
    // levert nog geen scherm op.
    expect(licensedFrom(['hr'], REGISTERED)).toEqual([]);
  });
});

describe('mayAssignModule', () => {
  it('staat toewijzing binnen de afname toe', () => {
    expect(mayAssignModule(['klantenservice', 'hr'], 'hr')).toBe(true);
  });

  it('weigert toewijzing buiten de afname', () => {
    // De UI toont alleen wat mag, maar een UI die alleen het juiste toont is
    // geen beveiliging. Dit is de plek waar het wordt geweigerd.
    expect(mayAssignModule(AFNAME_KS, 'sales')).toBe(false);
  });

  it('staat de joker toe — die betekent de afname zelf', () => {
    expect(mayAssignModule(AFNAME_KS, '*')).toBe(true);
  });
});

describe('samenspel met de rolgrants', () => {
  it('laat de rol nog steeds bepalen hoe diep er gekeken wordt', () => {
    const licensed = ['klantenservice'];
    const medewerker = access({
      role: 'reviewer',
      licensed,
      userModules: ['klantenservice'],
      grants: [...DEFAULT_ROLE_GRANTS],
    });
    const directie = access({
      role: 'admin',
      licensed,
      userModules: ['klantenservice'],
      grants: [...DEFAULT_ROLE_GRANTS],
    });

    expect(medewerker.categoriesIn('klantenservice')).toEqual(['operationeel']);
    expect(directie.categoriesIn('klantenservice')).toEqual([
      'operationeel',
      'commercieel',
      'financieel',
    ]);
  });
});
