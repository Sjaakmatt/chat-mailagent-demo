/**
 * Rechten: wat mag een rol, in welke module, met welke gegevens.
 *
 * Eén rechtenmodel, geen tweede ernaast. De rol die bepaalt wat iemand mag
 * góedkeuren in de werkbak (`admin | reviewer | viewer`, zie `access/index.ts`)
 * is dezelfde rol die bepaalt wat hij mag zíen. Wat erbij komt is dat een rol
 * dat niet meer overal in gelijke mate mag: het hangt af van de **module** en de
 * **datacategorie**.
 *
 * Waarom die twee assen en niet één:
 *
 *   module    — een salesmedewerker hoort geen administratie-item goed te
 *               keuren, ook niet als hij `reviewer` is. Het proces bepaalt of
 *               je er überhaupt bij hoort.
 *   categorie — binnen een proces bepaalt de categorie hoe diep je mag kijken.
 *               Een medewerker ziet de orderstatus, niet de marge.
 *
 * De grants leven per tenant in de database (`aios_role_grants`), niet in code:
 * welke rol wat mag is een afspraak met de klant en verandert. Deze module is
 * pure logica die de opgehaalde rijen omzet in een antwoord, zodat de plek waar
 * een fout een rechtenlek wordt, te testen is zonder database.
 */

import type { ModuleId } from '../contracts/index.js';
import type { Role } from './index.js';

/**
 * Datacategorie van een veld — agent-zijde spiegel van `DataCategory` in
 * `@factumai/shared` (de MCP-laag).
 *
 * Bewust een kopie en geen import: `agent-core` is self-contained en leunt niet
 * op de MCP-laag (zie CLAUDE.md). De drie waarden zijn een productafspraak en
 * liggen vast; wijken ze ooit, dan is dat een bewuste wijziging op twee plekken
 * en geen toeval. De MCP is en blijft degene die er velden mee afsluit — dit is
 * de lijst die de cockpit meestuurt.
 */
export type DataCategory = 'operationeel' | 'commercieel' | 'financieel';

export const DATA_CATEGORIES: readonly DataCategory[] = Object.freeze([
  'operationeel',
  'commercieel',
  'financieel',
]);

/** Jokerteken voor "alle modules" in een grant. */
export const ALL_MODULES = '*' as const;

/** Eén rij uit `aios_role_grants`: wat deze rol in deze module mag. */
export interface RoleGrant {
  role: Role;
  /** Module-id, of `'*'` voor elke geregistreerde module. */
  module: ModuleId | typeof ALL_MODULES;
  categories: readonly DataCategory[];
}

/**
 * Het standaardvoorstel uit de bouwbriefing, vertaald naar de bestaande rollen.
 *
 * Bewust conservatief aan de onderkant: `reviewer` is de dagelijkse
 * klantenservice-medewerker en die krijgt alleen operationeel. Wil een klant
 * dat zijn teamleiders ook orderbedragen zien, dan is dat een grant erbij —
 * geen codewijziging.
 *
 * Wordt door migratie 0031 geseed. Staat hier óók omdat een tenant zonder rijen
 * niet zonder rechten hoort te vallen: geen grants = dit, niet niets. Fail-safe
 * boven fail-closed, want een cockpit die niemand meer binnenlaat is een storing
 * en geen beveiliging — en de onderkant van dit voorstel lekt niets.
 */
export const DEFAULT_ROLE_GRANTS: readonly RoleGrant[] = Object.freeze([
  { role: 'viewer', module: ALL_MODULES, categories: ['operationeel'] },
  { role: 'reviewer', module: ALL_MODULES, categories: ['operationeel'] },
  {
    role: 'admin',
    module: ALL_MODULES,
    categories: ['operationeel', 'commercieel', 'financieel'],
  },
]);

/** Wat één rol mag, uitgerekend en klaar om te bevragen. */
export interface ResolvedAccess {
  role: Role;
  /** Mag deze rol in deze module werken? */
  mayEnter(module: ModuleId): boolean;
  /**
   * De datacategorieën die deze rol in deze module mag zien. Leeg als de rol
   * niet in de module mag — dan is er niets te tonen, ook niet operationeel.
   */
  categoriesIn(module: ModuleId): readonly DataCategory[];
  /** De modules waar deze rol in mag, uit een gegeven lijst geregistreerde. */
  modulesFrom(registered: readonly ModuleId[]): ModuleId[];
}

function normalizeCategories(
  values: readonly unknown[] | null | undefined,
): DataCategory[] {
  if (!values) return [];
  const seen = new Set<DataCategory>();
  for (const value of values) {
    if (DATA_CATEGORIES.includes(value as DataCategory)) {
      seen.add(value as DataCategory);
    }
  }
  // Vaste volgorde, licht naar zwaar — zodat twee gelijke grants ook gelijk
  // serialiseren en een diff in de auditlog betekenis heeft.
  return DATA_CATEGORIES.filter((c) => seen.has(c));
}

/**
 * Rekent uit wat `role` mag, gegeven alle grants van de tenant.
 *
 * Een grant op de module zelf wint van de joker: `'*'` is de bodem waar een
 * specifieke regel bovenop gaat. Dat maakt "iedereen operationeel, behalve in
 * administratie" uitdrukbaar zonder elke module te moeten opsommen.
 *
 * Géén rijen voor deze rol → `DEFAULT_ROLE_GRANTS`. Zie de opmerking daar.
 */
export function resolveAccess(
  role: Role,
  grants: readonly RoleGrant[],
): ResolvedAccess {
  const own = grants.filter((g) => g.role === role);
  const effective = own.length > 0 ? own : DEFAULT_ROLE_GRANTS.filter((g) => g.role === role);

  const wildcard = effective.find((g) => g.module === ALL_MODULES) ?? null;
  const perModule = new Map<string, RoleGrant>();
  for (const grant of effective) {
    if (grant.module !== ALL_MODULES) perModule.set(grant.module, grant);
  }

  const grantFor = (module: ModuleId): RoleGrant | null =>
    perModule.get(module) ?? wildcard;

  return {
    role,
    mayEnter(module: ModuleId): boolean {
      return grantFor(module) !== null;
    },
    categoriesIn(module: ModuleId): readonly DataCategory[] {
      const grant = grantFor(module);
      // Niet in de module = niets, ook niet operationeel. Een rol die er niet
      // hoort, hoort er ook geen orderstatus uit te kunnen lezen.
      if (!grant) return [];
      return normalizeCategories(grant.categories);
    },
    modulesFrom(registered: readonly ModuleId[]): ModuleId[] {
      return registered.filter((m) => grantFor(m) !== null);
    },
  };
}

/** Rij uit de database → `RoleGrant`. Onbekende waarden vallen weg. */
export function toRoleGrant(row: {
  role: string | null;
  module: string | null;
  categories: unknown;
}): RoleGrant | null {
  const role = row.role;
  if (role !== 'admin' && role !== 'reviewer' && role !== 'viewer') return null;
  const module = row.module?.trim();
  if (!module) return null;
  return {
    role,
    module,
    categories: normalizeCategories(
      Array.isArray(row.categories) ? row.categories : [],
    ),
  };
}

/**
 * De categorieën die een rol over álle modules heen mag zien.
 *
 * Voor schermen die niet aan één module hangen — de auditlog, de assistent
 * zonder open item. Bewust de vereniging en niet de doorsnede: als je in sales
 * commercieel mag zien, mag je dat ook zien in een lijst die sales bevat.
 */
export function categoriesAcross(
  access: ResolvedAccess,
  modules: readonly ModuleId[],
): readonly DataCategory[] {
  const seen = new Set<DataCategory>();
  for (const module of modules) {
    for (const category of access.categoriesIn(module)) seen.add(category);
  }
  return DATA_CATEGORIES.filter((c) => seen.has(c));
}
