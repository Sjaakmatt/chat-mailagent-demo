/**
 * Categorie-taxonomie — **het eerste bestand dat je per klant aanpast.**
 *
 * Dit is de gedeelde woordenlijst van de agent: de classifier kiest hieruit,
 * de beleidsregels matchen erop (`aios_policy_rules.applies_to`), en de cockpit
 * toont de labels. Agent-Worker én cockpit lezen dezelfde lijst, zodat een
 * categorie nooit half doorgevoerd kan zijn.
 *
 * De set hieronder is een neutrale klantenservice-startset. Vervang 'm door de
 * taxonomie die uit de discovery van de klant komt — meestal 8 à 12 categorieën.
 * Vuistregel: een categorie verdient een eigen slug als er ánder beleid of een
 * andere specialist bij hoort. Anders hoort 'ie bij `overig`.
 *
 * Bij het toevoegen van een categorie:
 *   1. Zet 'm in `CATEGORIES` (slug + label + specialist).
 *   2. Draai `pnpm -r test` — de contract-tests bewaken de consistentie.
 *   3. Maak een beleidsregel in de cockpit die op de nieuwe slug matcht.
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
  /**
   * Eén regel voor de classifier: wanneer hoort een bericht hier, en — vaak
   * belangrijker — wanneer níét.
   *
   * Dit is geen documentatie maar werkende configuratie. Een kale lijst slugs
   * laat het model raden wat een naam betekent, en dan belandt "ik zie een
   * mailagent op de website" onder `demo_aanvraag` omdat het woord "mailagent"
   * commercieel klinkt. Vervolgens vraagt de agent netjes om naam en bedrijf,
   * precies zoals het beleid voor die categorie voorschrijft, op een vraag die
   * gewoon een productvraag was.
   *
   * Schrijf de afbakening op, niet de omschrijving. "Alleen als de bezoeker zelf
   * om een gesprek vraagt" stuurt beter dan "demo-aanvragen".
   */
  hint?: string;
}

/** Neutrale startset — vervang per klant. */
export const CATEGORIES: readonly CategoryDef[] = Object.freeze([
  { slug: 'levertijd_status', label: 'Levertijd / status', specialist: 'simple_reply', hint: 'waar blijft mijn bestelling, wanneer wordt het geleverd, track & trace' },
  { slug: 'order_wijziging', label: 'Orderwijziging', specialist: 'order_change', hint: 'adres, aantal of artikel wijzigen, of annuleren vóór verzending' },
  { slug: 'retour_ruilen', label: 'Retour / ruilen', specialist: 'order_change', hint: 'retourneren, ruilen, herroepingsrecht, geld terug' },
  { slug: 'garantie_claim', label: 'Garantieclaim', specialist: 'complaint', hint: 'defect binnen de garantietermijn, ontbrekende of kapotte onderdelen' },
  { slug: 'product_vraag', label: 'Productvraag', specialist: 'simple_reply', hint: 'maten, materialen, compatibiliteit, gebruik — ook als de klant enthousiast klinkt. De standaard voor elke inhoudelijke vraag over een artikel' },
  { slug: 'technisch_probleem', label: 'Technisch probleem', specialist: 'technical', hint: 'werkt niet zoals verwacht, maar nog niet vastgesteld dat er iets stuk is' },
  { slug: 'facturatie', label: 'Facturatie', specialist: 'simple_reply', hint: 'facturen, betaalmethoden, btw, betaling die niet klopt' },
  { slug: 'klacht', label: 'Klacht', specialist: 'complaint', hint: 'ontevredenheid over een product, bezorging of afhandeling; boze of teleurgestelde toon' },
  { slug: 'commercieel', label: 'Commercieel', specialist: 'escalate', hint: 'grotere aantallen, offerte, wederverkoop, samenwerking. ALLEEN als de klant er zelf om vraagt' },
  { slug: 'gdpr_verzoek', label: 'Privacy / GDPR-verzoek', specialist: 'gdpr', hint: 'AVG-verzoek over de eigen gegevens van de schrijver: inzage, verwijdering, uitschrijven' },
  { slug: 'overig', label: 'Overig', specialist: 'escalate', hint: 'te vaag om te routeren, of past nergens onder. Bij een losse begroeting hoort dit, ook als er eerder in het gesprek iets anders speelde' },
]);

/**
 * De categorielijst zoals de classifier 'm te zien krijgt: slug plus afbakening.
 *
 * Een kale opsomming van slugs laat het model de betekenis raden uit de naam.
 * Dat gaat mis op precies de plek waar het duur is: "ik zie een mailagent op de
 * website" belandde onder `demo_aanvraag` omdat dat commercieel klinkt, waarna
 * de agent keurig om naam en bedrijf vroeg — het beleid voor die categorie.
 */
export const CATEGORY_GUIDE: string = CATEGORIES.map(
  (c) => `- ${c.slug}${c.hint ? `: ${c.hint}` : ''}`,
).join('\n');

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
