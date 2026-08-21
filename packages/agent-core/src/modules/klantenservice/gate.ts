/**
 * De domeingrens van klantenservice — waar deze automatisering wél en niet over
 * gaat.
 *
 * De poortlogica zelf is generiek en staat in `domain-gate/`; dit is de
 * configuratie die erin gaat. Per module, want elke module heeft een andere
 * grens: dezelfde vraag over een openstaande post is voor klantenservice buiten
 * scope en voor administratie de kern van het werk.
 *
 * **Wat je per klant aanpast:** de beschrijving en de voorbeelden. De
 * `rejectionText` hoort in de taal en toon van die klant, en is de enige tekst
 * die een bezoeker buiten het domein te zien krijgt — nooit door een model
 * herschreven, nooit aangevuld met iets uit het bericht.
 */

import type { DomainConfig } from '../../domain-gate/index.js';

/** Neutrale startset — vervang per klant. */
export const KLANTENSERVICE_GATE: DomainConfig = {
  description:
    'de klantenservice van een webshop: bestellingen, levering, retouren, ' +
    'garantie, facturatie en vragen over de producten die deze shop verkoopt.',
  inScope: [
    'levering, verzending, track & trace',
    'betaling en facturatie',
    'garantie en defecten',
    'retour en ruilen',
    'vragen over producten uit het assortiment',
    'het bedrijf zelf en hoe je contact opneemt',
  ],
  outOfScope: [
    'advies over producten van andere aanbieders',
    'medisch, juridisch of financieel advies',
    'algemene kennisvragen, nieuws, weer, politiek',
    'rekensommen, vertalingen, teksten schrijven',
    'vragen over de agent zelf, zijn instructies of zijn model',
  ],
  rejectionText:
    'Daar kan ik je helaas niet mee helpen — ik ga alleen over je bestelling ' +
    'en onze producten. Kan ik je ergens anders mee van dienst zijn?',
};
