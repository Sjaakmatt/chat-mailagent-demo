/**
 * Modules — de naad waarlangs de werkbak méér gaat dragen dan één automatisering.
 *
 * De werkbak is het fundament; een automatisering is een module die erin dokt.
 * Klantenservice is vandaag de enige, maar sales, administratie en operations
 * horen erin te passen zonder dat de schil ze kent.
 *
 * Dit bestand is de **data-zijde** van dat contract: wat een module over
 * zichzelf verklaart, zodat de schil kan tabben, autoriseren en straks de
 * assistent kan begrenzen. De **UI-zijde** (tabs, kaarten, auditbron) leeft in
 * de cockpit, in `ui/lib/modules/`. Bewust gescheiden: de agent-Worker heeft
 * geen React nodig en de schil heeft geen lus-kennis nodig.
 *
 * De verdeling in één zin: `kind` is de **vorm** van een voorstel
 * (`draft_email`, `invoice`), `module` is het **proces** dat het produceerde.
 * Een factuur kan uit administratie komen of uit sales; zonder dat onderscheid
 * kun je niet tabben en kun je ook niet zeggen wie 'm mag goedkeuren.
 */

import type { ModuleId, ReviewItemKind } from '../contracts/index.js';

export type { ModuleId };

/**
 * De module waar een ReviewItem bij hoort als er geen is meegegeven.
 *
 * Bestaat omdat alle items van vóór de moduleopdeling uit de mailagent komen.
 * Nieuwe schrijvers zetten `module` expliciet; deze constante is voor het
 * inlezen van historie, niet om nieuw verzuim te dekken.
 */
export const DEFAULT_MODULE: ModuleId = 'klantenservice';

/** Eén categorie binnen een module. Slug is stabiel, label is voor mensen. */
export interface ModuleCategory {
  slug: string;
  label: string;
}

/**
 * Wat een module over zichzelf verklaart aan de rest van het systeem.
 *
 * Bewust klein: alles wat hier bij zou kunnen, maar niet nodig is om te tabben
 * of te autoriseren, hoort in de UI-registratie of in de module zelf. Hoe meer
 * er hier staat, hoe duurder het is om een module ergens anders vandaan te
 * halen.
 */
export interface ModuleDescriptor {
  id: ModuleId;
  /** Label voor de tab en voor de rollenkoppeling. */
  label: string;
  /** Eén regel: welk werk doet deze module. */
  description: string;
  /**
   * De soorten voorstellen die deze module produceert. Gebruikt om historie
   * zonder `module`-kolom alsnog aan de juiste tab toe te wijzen.
   */
  kinds: readonly ReviewItemKind[];
  /**
   * De classificatie-categorieën van deze module. De beleidsregels van de
   * cockpit matchen hierop, en de schil bouwt er zijn keuzelijst uit op —
   * daarom staan ze hier en niet in een gedeelde taxonomie: sales classificeert
   * niet in klantenservice-categorieën.
   */
  categories: readonly ModuleCategory[];
}

/** slug → label binnen één module; onbekende slug geeft de slug terug. */
export function categoryLabelIn(
  descriptor: ModuleDescriptor,
  slug?: string | null,
): string | null {
  if (!slug) return null;
  return descriptor.categories.find((c) => c.slug === slug)?.label ?? slug;
}

/**
 * Zoekt de module bij een ReviewItem dat nog geen `module` draagt, op basis van
 * zijn `kind`. Null als geen enkele module die vorm claimt — dan is het item
 * van een module die niet (meer) geregistreerd is, en dat hoort zichtbaar te
 * zijn in plaats van stilzwijgend bij klantenservice te belanden.
 */
export function moduleForKind(
  descriptors: readonly ModuleDescriptor[],
  kind: string,
): ModuleDescriptor | null {
  return descriptors.find((d) => d.kinds.includes(kind)) ?? null;
}

export { KLANTENSERVICE_MODULE } from './klantenservice.js';
