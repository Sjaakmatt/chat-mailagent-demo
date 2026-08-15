/**
 * Categorie-taxonomie — **het eerste bestand dat je per klant aanpast.**
 *
 * Dit is de gedeelde woordenlijst van de agent: de classifier kiest hieruit,
 * de beleidsregels matchen erop (`aios_policy_rules.applies_to`), en de cockpit
 * toont de labels. Agent-Worker én cockpit lezen dezelfde lijst, zodat een
 * categorie nooit half doorgevoerd kan zijn.
 *
 * Vuistregel: een categorie verdient een eigen slug als er ánder beleid of een
 * andere specialist bij hoort. Anders hoort 'ie bij `overig`.
 *
 * Bij het toevoegen van een categorie:
 *   1. Zet 'm in `CATEGORIES` (slug + label + specialist).
 *   2. Draai `pnpm -r test` — de contract-tests bewaken de consistentie.
 *   3. Maak een beleidsregel die op de nieuwe slug matcht (`migrations/0023_*`
 *      of de cockpit). Zonder regel valt de categorie terug op generiek gedrag.
 */

import type { SpecialistId } from '../contracts/index.js';

export interface CategoryDef {
  /** Stabiele slug. Verandert nooit — beleidsregels en historie hangen eraan. */
  slug: string;
  /** Leesbaar label voor de cockpit (taal van de klant). */
  label: string;
  /**
   * Welke specialist deze categorie afhandelt als de router zelf geen intent
   * kiest. Conservatief invullen: bij twijfel `escalate` (naar een mens).
   */
  specialist: SpecialistId;
}

/**
 * Taxonomie voor Factum Webshop — de winkel waarin FactumAI zijn eigen
 * modulaire AI- en softwareproducten verkoopt: agents, koppelingen, modules en
 * de diensten eromheen.
 *
 * ## Waarom dit één wereld is en geen twee
 *
 * Bij een gewone webshop staan het product en de leverancier los van elkaar:
 * de klant vraagt naar zijn bureaulamp, niet naar de winkel. Hier vallen ze
 * samen. "Wat doet de mailagent" is tegelijk een productvraag én een vraag over
 * wat wij verkopen, en het antwoord is hetzelfde. Een aparte set categorieën
 * voor "over ons" zou de classifier een keuze laten maken die geen verschil
 * maakt — en dat is precies hoe je een classifier onbetrouwbaar maakt.
 *
 * ## Waar de scheidslijnen wél liggen, en waarom
 *
 * - `levertijd_status` gaat over een **lopend traject** met een ordernummer
 *   (lookup in de bron); `beschikbaarheid` over een artikel dat iemand
 *   overweegt. Andere bron, ander antwoord, ander beleid.
 * - `storing_sla` is er iets stuk bij een bestaande klant; `technisch_probleem`
 *   is het werkt niet zoals verwacht en dat is meestal een instelling. Die
 *   eerste heeft een reactietermijn, de tweede een checklist.
 * - `opzegging_proef` (weg willen) staat los van `order_wijziging` (iets anders
 *   willen). Commercieel twee heel verschillende gesprekken.
 * - `gdpr_verzoek` is een verzoek van een betrokkene over zijn eigen gegevens;
 *   `beveiliging_avg` is een informatieve vraag van iemand die overweegt klant
 *   te worden. Op één hoop gooien levert een agent op die een inzageverzoek als
 *   verkooppraatje behandelt.
 *
 * Bij een klant in een ander vak vervang je deze lijst. De structuur — een
 * statusvraag, een productvraag, een wijziging, een opzegging, een storing, een
 * klacht, een privacyverzoek en een vangnet — blijft in de praktijk staan.
 */
export const CATEGORIES: readonly CategoryDef[] = Object.freeze([
  // --- Oriënteren: iemand die nog niets heeft --------------------------
  { slug: 'product_vraag', label: 'Productvraag', specialist: 'simple_reply' },
  { slug: 'beschikbaarheid', label: 'Beschikbaarheid / levertijd', specialist: 'simple_reply' },
  { slug: 'koppelingen', label: 'Koppelingen', specialist: 'technical' },
  { slug: 'prijs_voorwaarden', label: 'Prijs / voorwaarden', specialist: 'simple_reply' },
  { slug: 'werkwijze', label: 'Werkwijze / platform', specialist: 'simple_reply' },
  { slug: 'implementatie', label: 'Implementatie', specialist: 'simple_reply' },
  { slug: 'beveiliging_avg', label: 'Beveiliging / AVG', specialist: 'simple_reply' },
  { slug: 'resultaat_roi', label: 'Resultaat / ROI', specialist: 'simple_reply' },
  { slug: 'vergelijking', label: 'Vergelijking met alternatieven', specialist: 'simple_reply' },
  { slug: 'offerte_aanvraag', label: 'Offerte', specialist: 'escalate' },
  { slug: 'demo_aanvraag', label: 'Demo / kennismaking', specialist: 'escalate' },

  // --- Klant zijn: iemand met een lopend traject of abonnement ---------
  { slug: 'levertijd_status', label: 'Status van je implementatie', specialist: 'simple_reply' },
  { slug: 'order_wijziging', label: 'Abonnement wijzigen', specialist: 'order_change' },
  { slug: 'opzegging_proef', label: 'Opzeggen / proefperiode', specialist: 'order_change' },
  { slug: 'storing_sla', label: 'Storing / SLA', specialist: 'complaint' },
  { slug: 'technisch_probleem', label: 'Technisch probleem', specialist: 'technical' },
  { slug: 'facturatie', label: 'Facturatie / betaling', specialist: 'simple_reply' },

  // --- Altijd apart ----------------------------------------------------
  { slug: 'klacht', label: 'Klacht', specialist: 'complaint' },
  { slug: 'commercieel', label: 'Zakelijk / partner', specialist: 'escalate' },
  { slug: 'gdpr_verzoek', label: 'Privacy / AVG-verzoek', specialist: 'gdpr' },
  { slug: 'overig', label: 'Overig', specialist: 'escalate' },
]);

/** Alle slugs — voor de classify-prompt en validatie. */
export const CATEGORY_SLUGS: readonly string[] = Object.freeze(
  CATEGORIES.map((c) => c.slug),
);

/** slug → label, voor cockpit-badges. */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.label])),
);

const CATEGORY_TO_SPECIALIST: Readonly<Record<string, SpecialistId>> = Object.freeze(
  Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.specialist])),
);

/**
 * Mapt een categorie op de bijbehorende SpecialistId. Onbekende categorie →
 * `escalate` (naar mens). Die fallback is bewust conservatief: beter een mens
 * dan een verkeerde specialist.
 */
export function categoryToSpecialist(category: string): SpecialistId {
  return CATEGORY_TO_SPECIALIST[category] ?? 'escalate';
}

/** Leesbaar label, met de slug zelf als terugval. */
export function categoryLabel(slug?: string | null): string | null {
  if (!slug) return null;
  return CATEGORY_LABELS[slug] ?? slug;
}
