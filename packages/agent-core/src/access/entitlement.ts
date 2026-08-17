/**
 * Afname en toewijzing — de twee lagen boven de rol.
 *
 * Er zijn drie vragen, en ze zijn van drie verschillende partijen:
 *
 *   1. **Wat heeft deze klant afgenomen?**  Van ons. Wij verkopen per afdeling;
 *      een klant die alleen klantenservice koopt, hoort sales nergens te kunnen
 *      aanzetten — ook zijn eigen beheerder niet.
 *   2. **Wie binnen die afname doet wat?**  Van de beheerder bij de klant. Jan
 *      doet klantenservice, Ans doet sales en marketing.
 *   3. **Hoe diep mag die persoon kijken?**  De rol, met zijn categorieën. Zie
 *      `grants.ts`.
 *
 * Toegang is de **doorsnede** van alle drie. Elke laag kan alleen beperken,
 * nooit verruimen. Dat is de hele regel, en daarom staat hij in één functie:
 * zodra dit op drie plekken los wordt uitgerekend, is er een plek die er één
 * vergeet.
 *
 * `'*'` is nadrukkelijk **niet** "alles wat bestaat". Voor een klant betekent
 * het "alles wat wij hebben afgenomen", en voor een gebruiker "alles wat mijn
 * organisatie heeft". Een beheerder bij de klant is een tenant-beheerder, geen
 * super admin — die laatste bestaat alleen aan onze kant, bij het zetten van de
 * afname.
 */

import type { ModuleId } from '../contracts/index.js';
import {
  ALL_MODULES,
  DATA_CATEGORIES,
  type DataCategory,
  type ResolvedAccess,
  type RoleGrant,
} from './grants.js';
import type { Role } from './index.js';

/**
 * Een verzameling modules, of de joker.
 *
 * De joker betekent "wat de laag erboven toestaat" — nooit meer. Bij de afname
 * is dat het volledige productaanbod (alleen zinvol voor onze eigen tenants en
 * demo's); bij een gebruiker is het de afname van zijn organisatie.
 */
export type ModuleSet = readonly ModuleId[] | typeof ALL_MODULES;

export interface UserAccessInput {
  role: Role;
  /** Rijen uit `aios_role_grants` van deze tenant. */
  grants: readonly RoleGrant[];
  /**
   * Wat deze tenant heeft afgenomen. Komt uit config die wij deployen, niet uit
   * de database van de klant — anders is het geen plafond maar een suggestie.
   */
  licensed: ModuleSet;
  /** Wat deze gebruiker binnen de afname mag. Uit `allowed_emails.modules`. */
  userModules: ModuleSet;
}

function has(set: ModuleSet, module: ModuleId): boolean {
  return set === ALL_MODULES || set.includes(module);
}

/**
 * Leest een module-verzameling uit ruwe waarden (config-string of DB-array).
 *
 * Leeg of ontbrekend → géén modules. Bewust fail-closed en anders dan bij de
 * rollen: een ontbrekende afname is geen storing die je wilt overbruggen, het
 * is een klant die niets heeft gekocht. `'*'` blijft de joker.
 */
export function parseModuleSet(input: unknown): ModuleSet {
  const values =
    typeof input === 'string'
      ? input.split(',')
      : Array.isArray(input)
        ? input
        : [];
  const out: ModuleId[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed === ALL_MODULES) return ALL_MODULES;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * De volledige toegangsberekening: afname ∩ gebruiker ∩ rol.
 *
 * `licensedFrom` is nodig omdat `'*'` pas betekenis krijgt tegenover een
 * concrete lijst — de modules die in deze cockpit geregistreerd zijn.
 */
export function resolveUserAccess(
  input: UserAccessInput,
  roleAccess: ResolvedAccess,
): ResolvedAccess {
  // Beide verzamelingen hier normaliseren, en niet bij de aanroeper.
  //
  // `ModuleSet` is `'*' | ModuleId[]`, en een ruwe `string[]` uit de database
  // past daar structureel op — dus TypeScript vangt het niet als iemand
  // `allowed_emails.modules` ongeparsed doorgeeft. Dan is de joker de ARRAY
  // `['*']` in plaats van de STRING `'*'`, en `has()` valt door naar
  // `.includes(module)`: die array bevat geen enkele module-id, dus de
  // gebruiker mag nergens in. Fail-closed, maar om de verkeerde reden — en het
  // ziet er in de cockpit uit als een lege werkbak zonder foutmelding.
  //
  // Precies dat is één keer gebeurd: de afname liep wél door `parseModuleSet`
  // en de gebruikersmodules niet. `parseModuleSet` is idempotent, dus dit
  // tweemaal aanroepen kan geen kwaad.
  const licensed = parseModuleSet(input.licensed);
  const userModules = parseModuleSet(input.userModules);

  const mayEnter = (module: ModuleId): boolean =>
    // Volgorde is bewust: de afname eerst. Dat is de grens die de klant niet
    // zelf kan verzetten, en hij hoort dus niet te wachten op de andere twee.
    has(licensed, module) && has(userModules, module) && roleAccess.mayEnter(module);

  return {
    role: input.role,
    mayEnter,
    categoriesIn(module: ModuleId): readonly DataCategory[] {
      if (!mayEnter(module)) return [];
      return roleAccess.categoriesIn(module);
    },
    modulesFrom(registered: readonly ModuleId[]): ModuleId[] {
      return registered.filter(mayEnter);
    },
  };
}

/**
 * De modules die deze tenant heeft afgenomen, uit een lijst geregistreerde.
 *
 * Registratie en afname zijn twee dingen: registratie zegt dat er code voor
 * bestaat, afname dat deze klant hem mag gebruiken. Een module die wél is
 * afgenomen maar (nog) niet geregistreerd, is toewijsbaar aan een gebruiker en
 * levert alleen nog geen scherm op — zo kun je iemand op HR zetten voordat de
 * HR-automatisering er is.
 */
export function licensedFrom(
  licensed: ModuleSet,
  registered: readonly ModuleId[],
): ModuleId[] {
  if (licensed === ALL_MODULES) return [...registered];
  return registered.filter((m) => licensed.includes(m));
}

/**
 * Mag deze tenant deze module aan een gebruiker toewijzen?
 *
 * Server-side check voor de Toegang-pagina. De UI toont alleen wat mag, maar
 * een UI die alleen het juiste tóónt, is geen beveiliging — dit is de plek waar
 * het wordt geweigerd.
 */
export function mayAssignModule(licensed: ModuleSet, module: string): boolean {
  if (module === ALL_MODULES) return true; // '*' = de afname zelf, nooit meer
  return has(licensed, module);
}

/** Alle categorieën, voor schermen die er een lijst van willen. */
export { DATA_CATEGORIES };
