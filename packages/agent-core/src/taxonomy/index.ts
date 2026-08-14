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
}

/** Neutrale startset — vervang per klant. */
export const CATEGORIES: readonly CategoryDef[] = Object.freeze([
  { slug: 'levertijd_status', label: 'Levertijd / status', specialist: 'simple_reply' },
  { slug: 'order_wijziging', label: 'Orderwijziging', specialist: 'order_change' },
  { slug: 'retour_ruilen', label: 'Retour / ruilen', specialist: 'order_change' },
  { slug: 'garantie_claim', label: 'Garantieclaim', specialist: 'complaint' },
  { slug: 'product_vraag', label: 'Productvraag', specialist: 'simple_reply' },
  { slug: 'technisch_probleem', label: 'Technisch probleem', specialist: 'technical' },
  { slug: 'facturatie', label: 'Facturatie', specialist: 'simple_reply' },
  { slug: 'klacht', label: 'Klacht', specialist: 'complaint' },
  { slug: 'commercieel', label: 'Commercieel', specialist: 'escalate' },
  { slug: 'gdpr_verzoek', label: 'Privacy / GDPR-verzoek', specialist: 'gdpr' },
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
