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
 * Taxonomie voor de Factum Webshop-demo.
 *
 * ## Twee werelden in één agent, en waarom dat hier klopt
 *
 * De widget staat op `factum-webshop` — een demo-webshop in werkplekartikelen
 * die FactumAI gebruikt om de agent aan prospects te laten zien. Daardoor
 * stellen bezoekers twee soorten vragen die allebei terecht zijn:
 *
 *   1. **Winkelvragen.** "Waar blijft DEMO-1001?", "Hoe lang heb ik bedenktijd?",
 *      "Zit er garantie op?" Dit is het echte werk: dit is wat de agent bij een
 *      klant de hele dag doet, en het is waar de demo op beoordeeld wordt.
 *   2. **Vragen over de agent zelf.** De bezoeker is vaak een prospect die op
 *      de winkel is beland via FactumAI. "Wat kost zoiets?", "Kan dit met onze
 *      Exchange?", "Gaat er een mens overheen?" Die vragen wegsturen zou de
 *      demo juist op het beslissende moment laten stilvallen.
 *
 * De `factumai_*`-prefix houdt die tweede wereld zichtbaar apart. Bij een echte
 * klant schrap je dat hele blok — dan blijft er een gewone, complete
 * webshop-taxonomie over. Dat is precies de bedoeling: het winkeldeel is de
 * herbruikbare startset, het FactumAI-deel is de demo-aankleding.
 *
 * ## Waar de scheidslijnen bewust liggen
 *
 * - `levertijd_status` gaat over een bestaande **order** (ordernummer, ERP-lookup);
 *   `voorraad_beschikbaarheid` over een **artikel** dat nog niet besteld is
 *   (voorraadlookup). Andere bron, ander antwoord, ander beleid.
 * - `bezorgprobleem` (pakket kwijt of beschadigd aangekomen) is losgehouden van
 *   `garantie_claim` (product ging later stuk). Juridisch en praktisch twee
 *   dingen: het eerste ligt bij de vervoerder, het tweede bij de fabrikant.
 * - `gdpr_verzoek` is een verzoek van een betrokkene over zijn eigen gegevens;
 *   `factumai_beveiliging` is een informatieve vraag van iemand die overweegt
 *   klant te worden. Op één hoop gooien levert een agent op die een
 *   inzageverzoek als verkooppraatje behandelt.
 */
export const CATEGORIES: readonly CategoryDef[] = Object.freeze([
  // --- De winkel: dit is het werk ---------------------------------------
  { slug: 'levertijd_status', label: 'Levertijd / status', specialist: 'simple_reply' },
  { slug: 'voorraad_beschikbaarheid', label: 'Voorraad / beschikbaarheid', specialist: 'simple_reply' },
  { slug: 'verzending_tarieven', label: 'Verzending / bezorgopties', specialist: 'simple_reply' },
  { slug: 'order_wijziging', label: 'Orderwijziging', specialist: 'order_change' },
  { slug: 'retour_ruilen', label: 'Retour / ruilen', specialist: 'order_change' },
  { slug: 'garantie_claim', label: 'Garantieclaim', specialist: 'complaint' },
  { slug: 'bezorgprobleem', label: 'Bezorgprobleem', specialist: 'complaint' },
  { slug: 'product_vraag', label: 'Productvraag', specialist: 'simple_reply' },
  { slug: 'technisch_probleem', label: 'Technisch probleem', specialist: 'technical' },
  { slug: 'facturatie', label: 'Facturatie / betaling', specialist: 'simple_reply' },
  { slug: 'klacht', label: 'Klacht', specialist: 'complaint' },
  { slug: 'commercieel', label: 'Commercieel / zakelijk', specialist: 'escalate' },
  { slug: 'gdpr_verzoek', label: 'Privacy / AVG-verzoek', specialist: 'gdpr' },

  // --- FactumAI: de demo-aankleding, schrappen bij een echte klant -------
  { slug: 'factumai_mailagent', label: 'FactumAI — mailagent', specialist: 'simple_reply' },
  { slug: 'factumai_chatbot', label: 'FactumAI — chatbot', specialist: 'simple_reply' },
  { slug: 'factumai_werkwijze', label: 'FactumAI — werkwijze', specialist: 'simple_reply' },
  { slug: 'factumai_koppelingen', label: 'FactumAI — koppelingen', specialist: 'technical' },
  { slug: 'factumai_prijs', label: 'FactumAI — prijs / voorwaarden', specialist: 'simple_reply' },
  { slug: 'factumai_beveiliging', label: 'FactumAI — beveiliging / AVG', specialist: 'simple_reply' },
  { slug: 'factumai_implementatie', label: 'FactumAI — implementatie', specialist: 'simple_reply' },
  { slug: 'factumai_resultaat', label: 'FactumAI — resultaat / ROI', specialist: 'simple_reply' },
  { slug: 'factumai_vergelijking', label: 'FactumAI — vergelijking', specialist: 'simple_reply' },
  { slug: 'factumai_demo', label: 'FactumAI — demo / kennismaking', specialist: 'escalate' },

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
