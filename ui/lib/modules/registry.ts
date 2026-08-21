/**
 * Het register van modules in de werkbak.
 *
 * De werkbak, de kaart, de beleidseditor en de auditlog praten met de registry
 * en niet met een module. Dat is de eigenschap die telt: gaat de werkbak later
 * naar een eigen repo, dan verhuizen de moduleregistraties mee met hun
 * automatisering en blijft dit bestand als lijst achter.
 *
 * Een module toevoegen is één regel in het `modules:`-blok van
 * `client.manifest.yaml`, gevolgd door `pnpm modules:generate`. Zie
 * `docs/MODULES.md`.
 */

import { categoryKey, type ModuleId } from "@factumai/agent-core";
import type { ReviewItemRow } from "@/lib/review";
import type { ModuleCategoryOption, WorkbenchModule } from "./contract";
import { GENERATED_MODULES } from "./registry.generated";

/**
 * De geregistreerde modules, in tabvolgorde.
 *
 * De lijst zelf komt uit `registry.generated.ts`, geschreven door
 * `scripts/generate-registry.mjs` uit het `modules:`-blok van
 * `client.manifest.yaml`. Dit bestand kent dus geen enkele module bij naam
 * meer, en de volgorde staat op één plek in plaats van verspreid over de
 * modules.
 *
 * Waarom gegenereerd: dit was hét bestand dat elke klant aanpaste, en dus het
 * bestand waarop elke fundament-update semantisch botst zonder dat git iets
 * meldt. Een conflict los je nu op door `pnpm modules:generate` te draaien.
 */
export const MODULES: readonly WorkbenchModule[] = GENERATED_MODULES;

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
 *
 * Neemt alleen `module` en `kind` en niet de volle rij: analytics en de
 * auditlog lezen een compacte projectie van dezelfde tabel, en die horen de
 * grens op precies dezelfde manier te trekken als de werkbak. Een tweede
 * functie ernaast is een tweede plek waar hij een keer anders wordt getrokken.
 */
export function moduleForRow(
  row: Pick<ReviewItemRow, "module" | "kind">,
): WorkbenchModule | null {
  return (
    moduleById(row.module) ?? MODULES.find((m) => m.kinds.includes(row.kind)) ?? null
  );
}

/** Eén categorie zoals de schil hem buiten zijn module aanduidt. */
export interface RegisteredCategory extends ModuleCategoryOption {
  module: ModuleId;
  moduleLabel: string;
  /** `module:slug` — de sleutel waarop beleidsregels matchen. */
  key: string;
}

/**
 * Alle categorieën van alle modules, met hun module erbij. Voedt de
 * beleidseditor: een regel matcht op een categorie, en de gebruiker moet zien
 * uit welk proces die komt zodra er meer dan één is.
 *
 * Ontdubbelt op `{module, slug}` en niet op slug alleen. Dat was een stille
 * bug: deelde administratie de slug `facturatie` met klantenservice, dan viel
 * de tweede uit de lijst en was er geen enkele manier om er beleid op te
 * maken — zonder foutmelding, want de eerste stond er gewoon.
 */
export function allCategories(): RegisteredCategory[] {
  const seen = new Set<string>();
  const out: RegisteredCategory[] = [];
  for (const mod of MODULES) {
    for (const category of mod.categories) {
      const key = categoryKey(mod.id, category.slug);
      // Een module die dezelfde slug twee keer opgeeft is een fout in die
      // module, niet iets om hier te tonen.
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...category, module: mod.id, moduleLabel: mod.label, key });
    }
  }
  return out;
}

/**
 * Label bij een categorie. `module` weglaten mag, maar dan wint de eerste
 * module die de slug kent — gebruik dat alleen waar de module echt onbekend is
 * (historie zonder `module`-kolom). Onbekende slug geeft de slug terug, zodat
 * een experimentele categorie zichtbaar blijft in plaats van te verdwijnen.
 */
export function categoryLabel(
  slug?: string | null,
  module?: ModuleId | null,
): string | null {
  if (!slug) return null;
  for (const mod of MODULES) {
    if (module && mod.id !== module) continue;
    const hit = mod.categories.find((c) => c.slug === slug);
    if (hit) return hit.label;
  }
  return slug;
}

/**
 * Alle auditbronnen die modules meebrengen, elk met zijn module erbij. Die
 * herkomst is wat de auditlog nodig heeft om de events van een afdeling weg te
 * laten bij iemand die er niet in mag.
 */
export function moduleAuditSources() {
  return MODULES.flatMap((m) =>
    m.auditSource ? [{ ...m.auditSource, module: m.id }] : [],
  );
}

/** Alle extra zijbalk-items die modules meebrengen. */
export function moduleNavItems() {
  return MODULES.flatMap((m) => (m.navItems ? [...m.navItems] : []));
}
