/**
 * Het register van modules in de werkbak.
 *
 * Dit bestand is het **enige** in de cockpit dat een module bij naam kent. Al
 * het andere — de werkbak, de kaart, de beleidseditor, de auditlog — praat met
 * de registry en niet met een module. Dat is de eigenschap die telt: gaat de
 * werkbak later naar een eigen repo, dan verhuizen de moduleregistraties mee
 * met hun automatisering en blijft dit bestand als lijst achter.
 *
 * Een module toevoegen is twee regels: importeren en in `MODULES` zetten.
 */

import type { ModuleId } from "@factumai/agent-core";
import type { ReviewItemRow } from "@/lib/review";
import type { ModuleCategoryOption, WorkbenchModule } from "./contract";
import { klantenserviceModule } from "./klantenservice";

/**
 * De geregistreerde modules, in tabvolgorde.
 *
 * Vandaag één. Sales, administratie en operations komen hier straks bij te
 * staan, en de schil merkt daar niets van.
 */
export const MODULES: readonly WorkbenchModule[] = Object.freeze(
  [klantenserviceModule].sort((a, b) => a.order - b.order),
);

/** De module met dit id, of null als hij niet geregistreerd is. */
export function moduleById(id: string | null | undefined): WorkbenchModule | null {
  if (!id) return null;
  return MODULES.find((m) => m.id === id) ?? null;
}

/**
 * De module waar deze rij bij hoort.
 *
 * Eerst op `module`, want dat is wat de schrijver bedoelde. Valt terug op
 * `kind` voor items van vóór migratie 0030 — die dragen de kolom niet.
 * Null als geen enkele geregistreerde module de rij claimt; dat hoort zichtbaar
 * te zijn (het item komt uit een module die niet meer geïnstalleerd is) in
 * plaats van stilzwijgend in de eerste tab te belanden.
 */
export function moduleForRow(row: ReviewItemRow): WorkbenchModule | null {
  return (
    moduleById(row.module) ?? MODULES.find((m) => m.kinds.includes(row.kind)) ?? null
  );
}

/**
 * Alle categorieën van alle modules, ontdubbeld op slug en met hun module
 * erbij. Voedt de beleidseditor: een regel matcht op een categorie, en de
 * gebruiker moet zien uit welk proces die komt zodra er meer dan één is.
 */
export function allCategories(): (ModuleCategoryOption & {
  module: ModuleId;
  moduleLabel: string;
})[] {
  const seen = new Set<string>();
  const out: (ModuleCategoryOption & { module: ModuleId; moduleLabel: string })[] = [];
  for (const mod of MODULES) {
    for (const category of mod.categories) {
      if (seen.has(category.slug)) continue;
      seen.add(category.slug);
      out.push({ ...category, module: mod.id, moduleLabel: mod.label });
    }
  }
  return out;
}

/** slug → label over alle modules heen; onbekende slug geeft de slug terug. */
export function categoryLabel(slug?: string | null): string | null {
  if (!slug) return null;
  for (const mod of MODULES) {
    const hit = mod.categories.find((c) => c.slug === slug);
    if (hit) return hit.label;
  }
  return slug;
}

/** Alle auditbronnen die modules meebrengen. */
export function moduleAuditSources() {
  return MODULES.flatMap((m) => (m.auditSource ? [m.auditSource] : []));
}

/** Alle extra zijbalk-items die modules meebrengen. */
export function moduleNavItems() {
  return MODULES.flatMap((m) => (m.navItems ? [...m.navItems] : []));
}
