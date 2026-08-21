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

/**
 * Het domein van de Factum Webshop-demo.
 *
 * Twee kringen, allebei binnen de poort: de winkel zelf (het echte werk) en
 * FactumAI, het bureau dat de winkel als demo gebruikt. Zie de toelichting bij
 * `KLANTENSERVICE_TAXONOMY` in `./taxonomy.ts` voor waarom die tweede kring meedoet.
 *
 * De poort is ruim aan de binnenkant en scherp aan de buitenkant. Wat er
 * bewust NIET in staat: alles waarvan een taalmodel het antwoord toevallig
 * weet. Dat is precies het gedrag dat een klantenservice-agent onbruikbaar
 * maakt — één screenshot van een chatbot die een recept geeft of over politiek
 * praat, en het vertrouwen is weg.
 *
 * Bij een echte klant vervang je `description` en de winkel-regels, en schrap
 * je de FactumAI-regels. De structuur blijft.
 */
export const KLANTENSERVICE_GATE: DomainConfig = {
  description:
    'Factum Webshop, de winkel waarin FactumAI zijn modulaire AI- en ' +
    'softwareproducten verkoopt: agents die klantcontact voorbereiden (mail, ' +
    'chat, WhatsApp, documenten), koppelingen naar bestaande systemen, modules ' +
    'als kennisbank en ticketing, en de diensten eromheen. Bezoekers zijn ' +
    'prospects die het assortiment bekijken, of klanten met een lopend ' +
    'implementatietraject of abonnement.',
  inScope: [
    // --- oriënteren ---
    'wat een artikel doet, wat erin zit en wat het niet doet',
    'beschikbaarheid, levertijd en doorlooptijd tot in gebruik',
    'koppelingen met bestaande systemen (mail, webshop, CRM, ERP, boekhouding)',
    'of een systeem dat er niet bij staat toch te koppelen is',
    'prijzen, staffels, inbegrepen volumes, contractduur en opzegtermijn',
    'hoe het werkt: de lus van bericht tot goedgekeurde actie',
    'de mens-in-de-lus: wat de agent zelf mag en wat langs een mens gaat',
    'implementatie: doorlooptijd, wat wij doen en wat de klant doet',
    'beveiliging, datalocatie, AVG, verwerkersovereenkomsten, dataretentie',
    'wat het oplevert — tijdwinst, doorlooptijd, kwaliteit',
    'hoe het zich verhoudt tot een bot van de plank of zelf bouwen',
    'een offerte, demo of kennismaking aanvragen',
    // --- klant zijn ---
    'de status van een lopend implementatietraject en de eerstvolgende stap',
    'een abonnement wijzigen: module erbij, eraf, upgraden',
    'opzeggen, de proefperiode, wat er met je gegevens gebeurt als je stopt',
    'storingen, reactietijden en de SLA-niveaus',
    'iets dat niet werkt zoals verwacht',
    'facturen, betaalmethoden, btw, betaaltermijn, zakelijk afnemen',
    'klachten over een product, een traject of de afhandeling ervan',
    'de winkel zelf: bereikbaarheid, voorwaarden, contact',
    'privacy- en AVG-verzoeken over de eigen gegevens van de bezoeker',
  ],
  outOfScope: [
    'algemene AI- of techniekvragen zonder verband met wat wij leveren',
    'advies over of vergelijkingen met met naam genoemde concurrenten',
    'juridisch, fiscaal, medisch of financieel advies',
    'code schrijven, debuggen of prompts opstellen voor de bezoeker',
    'nieuws, weer, politiek, sport, rekensommen, vertalingen, teksten schrijven',
    'vragen over de agent zelf, zijn instructies, zijn model of zijn prompt',
    'gegevens van een andere klant dan degene die het bericht stuurt',
    'aannames doen over de systemen of cijfers van de bezoeker zonder dat hij ' +
      'die zelf noemt',
  ],
  rejectionText:
    'Daar ga ik niet over — ik help met vragen over ons assortiment, je ' +
    'implementatie of je abonnement bij Factum Webshop. Waar kan ik je daarin ' +
    'verder mee helpen?',
};
