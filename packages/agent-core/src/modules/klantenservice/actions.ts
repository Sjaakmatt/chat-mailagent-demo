/**
 * De schrijfoperaties van klantenservice.
 *
 * De agent kiest hieruit; hij bedenkt geen nieuwe operaties. Dat is het
 * verschil tussen een agent die handelt binnen afgesproken grenzen en een
 * agent die zelf verzint wat hij in andermans systeem gaat schrijven.
 *
 * Per module en niet globaal: een creditnota en een adreswijziging zijn
 * operaties van een webshop. Administratie brengt straks een eigen set mee.
 *
 * **Slugs zijn uniek over álle modules heen.** `aios_proposed_actions.type`
 * draagt alleen de slug, dus twee modules met dezelfde slug zouden niet uit
 * elkaar te houden zijn bij het goedkeuren. De registry weigert dat luid.
 * Wil je dezelfde operatie in twee processen, geef ze dan een eigen slug.
 */

import type { ActionTypeDef } from '../../actions/index.js';

/**
 * De startset.
 *
 * Volgorde is niet willekeurig. `werkticket_aanmaken` staat eerst omdat dat het
 * type is om de machinerie op te beproeven: de tool bestaat al, de impact op de
 * klant is nul, en beide kanalen mogen. Een fout kost hier een overbodig ticket
 * en niets anders.
 *
 * De typen waarvan de tool nog niet bestaat staan er bewust wél in, met
 * `enabled` per tenant als rem: de registratie is de plek waar je ziet wat er
 * nog moet komen, en een lege lijst zou dat verstoppen.
 */
export const KLANTENSERVICE_ACTIONS: readonly ActionTypeDef[] = Object.freeze([
  {
    slug: 'werkticket_aanmaken',
    label: 'Werkticket aanmaken',
    target: { mcp: 'tickets', tool: 'create_ticket' },
    preconditionKind: 'geen',
    channels: ['mail', 'chat'],
    // Intern, geen klantimpact: hier is doorvragen duurder dan de fout.
    requiredIdentification: 'zwak',
    approverRole: 'reviewer',
    expiresAfterMinutes: 7 * 24 * 60,
    payloadFields: [
      { name: 'subject', label: 'Onderwerp', hint: 'korte omschrijving van wat er uitgezocht moet worden' , source: 'bericht', editable: true },
      { name: 'description', label: 'Toelichting', hint: 'wat de klant vraagt, in eigen woorden' , source: 'bericht', editable: true },
    ],
  },
  {
    slug: 'order_annuleren',
    label: 'Order annuleren',
    target: { mcp: 'crm', tool: 'update_order' },
    preconditionKind: 'orderstatus',
    // Onomkeerbaar aan klantzijde; niet vanuit een chatgesprek.
    channels: ['mail'],
    requiredIdentification: 'gematcht',
    approverRole: 'reviewer',
    expiresAfterMinutes: 24 * 60,
    payloadFields: [
      { name: 'orderNumber', label: 'Ordernummer', hint: 'het ordernummer uit de opgehaalde order' },
      { name: 'reason', label: 'Reden', hint: 'waarom de klant annuleert' , source: 'bericht', editable: true },
    ],
  },
  {
    slug: 'adres_wijzigen',
    // Bewust niet 'Verzendadres wijzigen'. Bij een klant die dozen verstuurt is
    // dit het afleveradres; bij een dienstverlener het adres op het contract.
    // Dezelfde actie, dezelfde fraudewaarde, dus één type — een label dat maar
    // op de helft van de klanten slaat, is een label dat je per klant moet
    // patchen.
    label: 'Adres wijzigen',
    target: { mcp: 'erp', tool: 'update_order_address' },
    preconditionKind: 'orderstatus',
    // De grootste fraudewaarde van de hele set: een adres omleggen is schade,
    // geen ongemak. Daarom mail-only, en bij mail nog steeds gematcht.
    channels: ['mail'],
    requiredIdentification: 'gematcht',
    approverRole: 'reviewer',
    expiresAfterMinutes: 12 * 60,
    payloadFields: [
      { name: 'orderNumber', label: 'Ordernummer', hint: 'het ordernummer uit de opgehaalde order' },
      { name: 'address.street', label: 'Straat en huisnummer', hint: 'exact zoals de klant het opgaf' , source: 'bericht', editable: true },
      { name: 'address.postalCode', label: 'Postcode', hint: 'exact zoals de klant het opgaf' , source: 'bericht', editable: true },
      { name: 'address.city', label: 'Plaats', hint: 'exact zoals de klant het opgaf' , source: 'bericht', editable: true },
    ],
  },
  {
    slug: 'retour_aanmelden',
    label: 'Retour aanmelden',
    target: { mcp: 'erp', tool: 'register_return' },
    preconditionKind: 'orderstatus',
    // Schade bij misbruik is klein, dus chat mag — maar dan wel bevestigd.
    channels: ['mail', 'chat'],
    requiredIdentification: 'bevestigd',
    approverRole: 'reviewer',
    expiresAfterMinutes: 7 * 24 * 60,
    payloadFields: [
      { name: 'orderNumber', label: 'Ordernummer', hint: 'het ordernummer uit de opgehaalde order' },
      { name: 'sku', label: 'Artikel', hint: 'het artikelnummer uit de opgehaalde orderregels' },
      { name: 'reason', label: 'Reden', hint: 'waarom het artikel retour gaat' , source: 'bericht', editable: true },
    ],
  },
  {
    slug: 'nalevering_aanmaken',
    label: 'Nalevering aanmaken',
    target: { mcp: 'erp', tool: 'create_backorder_shipment' },
    preconditionKind: 'orderstatus',
    // Er gaan goederen de deur uit. Niet vanuit een chatgesprek waar de
    // bezoeker het afzenderadres zelf intypt.
    channels: ['mail'],
    requiredIdentification: 'gematcht',
    approverRole: 'reviewer',
    expiresAfterMinutes: 7 * 24 * 60,
    payloadFields: [
      { name: 'orderNumber', label: 'Ordernummer', hint: 'het ordernummer uit de opgehaalde order' },
      { name: 'sku', label: 'Artikel', hint: 'het artikelnummer dat ontbrak, uit de orderregels' },
      { name: 'quantity', label: 'Aantal', hint: 'hoeveel er nageleverd moet worden', editable: true },
    ],
  },
  {
    slug: 'onderzoek_vervoerder',
    label: 'Onderzoek bij vervoerder starten',
    target: { mcp: 'shipping', tool: 'shipping_open_investigation' },
    preconditionKind: 'geen',
    // Geen geld en geen goederen, dus lichter dan een creditnota. Maar er komt
    // wél een dossier over andermans pakket bij een externe partij te liggen,
    // en dat is precies wat een anoniem gesprek niet in gang moet kunnen
    // zetten. Vandaar mail, en daar gematcht.
    channels: ['mail'],
    requiredIdentification: 'gematcht',
    approverRole: 'reviewer',
    expiresAfterMinutes: 7 * 24 * 60,
    payloadFields: [
      { name: 'trackingCode', label: 'Trackingcode', hint: 'de trackingcode uit de opgehaalde zending' },
      { name: 'carrier', label: 'Vervoerder', hint: 'de vervoerder uit de opgehaalde zending' },
      { name: 'reason', label: 'Aanleiding', hint: 'wat de klant meldt over het pakket' , source: 'bericht', editable: true },
    ],
  },
  {
    slug: 'creditnota_voorstellen',
    label: 'Creditnota voorstellen',
    target: { mcp: 'crm', tool: 'create_credit_note' },
    preconditionKind: 'factuurstatus',
    channels: ['mail'],
    requiredIdentification: 'gematcht',
    approverRole: 'reviewer',
    // Schade zonder beeld is een bewering. Vragen om een foto kost de klant een
    // minuut; een onterechte creditnota kost geld en is niet terug te draaien.
    requiresPhoto: true,
    // Geld. Boven dit bedrag moet een admin het doen.
    amountThreshold: 250,
    expiresAfterMinutes: 24 * 60,
    payloadFields: [
      { name: 'invoiceNumber', label: 'Factuurnummer', hint: 'het factuurnummer uit de opgehaalde factuur' },
      { name: 'amount', label: 'Bedrag', hint: 'bedrag in euro, uitsluitend uit de opgehaalde factuurregels', editable: true },
      { name: 'reason', label: 'Reden', hint: 'waarvoor gecrediteerd wordt' , source: 'bericht', editable: true },
    ],
  },
]);
