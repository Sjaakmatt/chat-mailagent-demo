/**
 * Het taxonomie-contract — wat een categorie is, niet welke categorieën er zijn.
 *
 * Een taxonomie is de gedeelde woordenlijst van één **module**: de classifier
 * van dat proces kiest eruit, de beleidsregels matchen erop
 * (`aios_policy_rules.applies_to`, als `module:slug`), en de cockpit toont de
 * labels. De lijst zelf staat op het pakket — `modules/klantenservice/taxonomy.ts`
 * voor de mailagent.
 *
 * Tot fase 1 stond hier één `CATEGORIES` met elf webshop-categorieën. Dat las
 * als "de taxonomie van de agent", en dat is precies waarom een tweede domein
 * er niet naast paste: administratie classificeert niet in
 * klantenservice-categorieën.
 *
 * **Het bestand dat je per klant aanpast** is daarmee verhuisd naar de
 * taxonomie van de module die je wijzigt. De helpers hieronder blijven
 * generiek: ze nemen de lijst als parameter.
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

/**
 * De categorielijst zoals de classifier 'm te zien krijgt: slug plus afbakening.
 *
 * Een kale opsomming van slugs laat het model de betekenis raden uit de naam.
 * Dat gaat mis op precies de plek waar het duur is: "ik zie een mailagent op de
 * website" belandde onder `demo_aanvraag` omdat dat commercieel klinkt, waarna
 * de agent keurig om naam en bedrijf vroeg — het beleid voor die categorie.
 */
export function categoryGuide(taxonomy: readonly CategoryDef[]): string {
  return taxonomy.map((c) => `- ${c.slug}${c.hint ? `: ${c.hint}` : ''}`).join('\n');
}

/** Alle slugs van deze taxonomie — voor de classify-prompt en validatie. */
export function categorySlugs(taxonomy: readonly CategoryDef[]): string[] {
  return taxonomy.map((c) => c.slug);
}

/**
 * Mapt een categorie op de bijbehorende `SpecialistId`. Onbekende categorie →
 * `escalate` (naar mens). Die fallback is bewust conservatief: beter een mens
 * dan een verkeerde specialist.
 */
export function categoryToSpecialist(
  taxonomy: readonly CategoryDef[],
  category: string,
): SpecialistId {
  return taxonomy.find((c) => c.slug === category)?.specialist ?? 'escalate';
}

/**
 * Leesbaar label, met de slug zelf als terugval.
 *
 * Terugvallen en niet leeg teruggeven: een experimentele categorie hoort
 * zichtbaar te blijven in plaats van uit een badge te verdwijnen.
 */
export function categoryLabel(
  taxonomy: readonly CategoryDef[],
  slug?: string | null,
): string | null {
  if (!slug) return null;
  return taxonomy.find((c) => c.slug === slug)?.label ?? slug;
}
