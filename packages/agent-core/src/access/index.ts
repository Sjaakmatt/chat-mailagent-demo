/**
 * Toegangsregels voor de cockpit: wie mag inloggen en met welke rol.
 *
 * De allowlist (`allowed_emails`) kent twee soorten regels:
 *
 *   `jan@klant.nl`   één persoon
 *   `@klant.nl`      iedereen met een adres op dat domein
 *
 * Domeinregels bestaan omdat de meeste klanten "iedereen bij ons" bedoelen en
 * niet elke medewerker los willen uitnodigen. Een persoonlijke regel wint
 * altijd van de domeinregel — zo kun je één iemand een andere rol geven, of met
 * `viewer` iemand terugschroeven zonder het domein aan te passen.
 *
 * Deze module doet géén database-toegang: hij krijgt de rijen aangereikt en
 * beslist. Dat is bewust, want dit is de plek waar een fout een auth-bypass
 * wordt, en pure logica is te testen zonder Supabase erbij te halen.
 */

export type Role = 'admin' | 'reviewer' | 'viewer';

export const ROLES: readonly Role[] = ['admin', 'reviewer', 'viewer'];

/** Eén rij uit `allowed_emails`. */
export interface AllowlistRow {
  email: string;
  role: string | null;
  /**
   * Afdelingen waarin deze gebruiker werkt (migratie 0032). `['*']` = alles wat
   * de organisatie heeft afgenomen. Ontbreekt bij oudere rijen; dan geldt de
   * joker, want vóór deze kolom had niemand een beperking.
   */
  modules?: string[] | null;
}

/** Normaliseert een adres: trimmen en lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * De domeinregel die bij een adres hoort: `jan@klant.nl` → `@klant.nl`.
 * Null als het adres geen bruikbaar domein heeft.
 *
 * Bewust `lastIndexOf`: bij een adres met meerdere apenstaartjes telt het
 * laatste, want dat is het deel dat de mailserver als domein leest.
 */
export function domainRuleFor(email: string): string | null {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  // Geen apenstaartje, niets ervóór, of niets erachter → geen domein.
  if (at <= 0 || at === normalized.length - 1) return null;
  const domain = normalized.slice(at + 1);
  // Een domein zonder punt is geen publiek adresseerbaar domein. Dit sluit
  // ook de lege regel "@" uit, die anders iedereen zou binnenlaten.
  if (!domain.includes('.')) return null;
  return `@${domain}`;
}

/** Is dit een domeinregel (`@klant.nl`) in plaats van één adres? */
export function isDomainRule(entry: string): boolean {
  return normalizeEmail(entry).startsWith('@');
}

/**
 * De twee allowlist-sleutels waarop een adres kan matchen: het adres zelf en
 * z'n domeinregel. Gebruik dit voor de query, zodat er precies één rondje naar
 * de database gaat.
 */
export function allowlistKeysFor(email: string): string[] {
  const normalized = normalizeEmail(email);
  const domain = domainRuleFor(normalized);
  return domain ? [normalized, domain] : [normalized];
}

/**
 * Kiest de rol bij een adres uit de opgehaalde rijen. Null = geen toegang.
 *
 * Let op de vergelijking: het domein moet **exact** gelijk zijn, nooit een
 * suffix-match. Anders zou een regel voor `@klant.nl` ook `@nietklant.nl`
 * binnenlaten — precies het soort fout dat een allowlist waardeloos maakt.
 */
export function resolveRoleFromRows(
  email: string,
  rows: readonly AllowlistRow[],
): Role | null {
  const normalized = normalizeEmail(email);
  const domain = domainRuleFor(normalized);

  let domainMatch: AllowlistRow | undefined;
  for (const row of rows) {
    const entry = normalizeEmail(row.email ?? '');
    if (entry === normalized) return toRole(row.role);
    if (domain && entry === domain) domainMatch = row;
  }
  return domainMatch ? toRole(domainMatch.role) : null;
}

/** Onbekende of lege rol → reviewer; nooit stilzwijgend admin. */
function toRole(value: string | null): Role {
  return ROLES.includes(value as Role) ? (value as Role) : 'reviewer';
}

/** Rol én afdelingen van het adres. Null = geen toegang. */
export interface AllowlistEntry {
  role: Role;
  /** Ruwe waarde uit de rij; `parseModuleSet` maakt er een ModuleSet van. */
  modules: string[];
}

/**
 * Zoals `resolveRoleFromRows`, maar geeft ook de afdelingen van de winnende
 * rij terug. Dezelfde voorrangsregel: een persoonlijke regel wint van de
 * domeinregel — je wilt één iemand een andere afdeling kunnen geven zonder het
 * hele domein aan te passen.
 */
export function resolveAllowlistEntry(
  email: string,
  rows: readonly AllowlistRow[],
): AllowlistEntry | null {
  const normalized = normalizeEmail(email);
  const domain = domainRuleFor(normalized);

  let domainMatch: AllowlistRow | undefined;
  for (const row of rows) {
    const entry = normalizeEmail(row.email ?? '');
    if (entry === normalized) return toEntry(row);
    if (domain && entry === domain) domainMatch = row;
  }
  return domainMatch ? toEntry(domainMatch) : null;
}

function toEntry(row: AllowlistRow): AllowlistEntry {
  return {
    role: toRole(row.role),
    // Ontbrekende kolom (rij van vóór migratie 0032) → de joker. Die betekent
    // "alles wat de organisatie heeft afgenomen", dus het is geen verruiming.
    modules: row.modules && row.modules.length > 0 ? row.modules : ['*'],
  };
}

/**
 * Mag dit als allowlist-regel worden opgeslagen? Spiegelt de check-constraint
 * uit migratie 0022, zodat de UI een nette melding geeft in plaats van een
 * database-fout.
 */
export function isValidAllowlistEntry(entry: string): boolean {
  const value = normalizeEmail(entry);
  if (isDomainRule(value)) return domainRuleFor(`x${value}`) === value;
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return false;
  if (/\s/.test(value)) return false;
  return value.slice(at + 1).includes('.');
}

export * from './grants.js';
export * from './entitlement.js';
