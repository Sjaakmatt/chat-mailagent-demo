/**
 * De categorie-taxonomie van klantenservice — **het eerste bestand dat je per
 * klant aanpast.**
 *
 * Dit is de gedeelde woordenlijst van dit proces: de classifier kiest hieruit,
 * de beleidsregels matchen erop (als `klantenservice:<slug>`), en de cockpit
 * toont de labels. Agent-Worker én cockpit lezen dezelfde lijst via het pakket,
 * zodat een categorie nooit half doorgevoerd kan zijn.
 *
 * De set hieronder is een neutrale klantenservice-startset. Vervang 'm door de
 * taxonomie die uit de discovery van de klant komt — meestal 8 à 12 categorieën.
 * Vuistregel: een categorie verdient een eigen slug als er ánder beleid of een
 * andere specialist bij hoort. Anders hoort 'ie bij `overig`.
 *
 * Bij het toevoegen van een categorie:
 *   1. Zet 'm hieronder (slug + label + specialist + afbakening).
 *   2. Draai `pnpm -r test` en `pnpm eval:golden` — die bewaken de consistentie.
 *   3. Maak een beleidsregel in de cockpit die op de nieuwe categorie matcht.
 *
 * Gaat de nieuwe categorie over een ánder proces (een inkoopfactuur, een
 * offerte), dan hoort hij niet hier maar in de taxonomie van dát pakket.
 */

import type { CategoryDef } from '../../taxonomy/index.js';

/** Neutrale startset — vervang per klant. */
export const KLANTENSERVICE_TAXONOMY: readonly CategoryDef[] = Object.freeze([
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
