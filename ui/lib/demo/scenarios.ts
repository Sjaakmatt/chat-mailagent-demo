/**
 * Demo-scenario's — synthetische klantmails om de agent te tonen zonder dat er
 * een live mailbox aan hangt.
 *
 * Deze mails gaan door de **echte** pipeline: ze worden als Signal geëmit,
 * de poller pakt ze op, de agent classificeert/plant/grondt ze, en het
 * resultaat verschijnt als ReviewItem in de werkbak. Wat je in een demo laat
 * zien is dus het echte gedrag van de agent, niet een schermafdruk.
 *
 * Bij een nieuwe klant: vervang deze mails door herkenbare voorbeelden uit hún
 * inbox (geanonimiseerd). Een demo werkt pas als de prospect z'n eigen
 * werkelijkheid herkent — kies de mails die intern het meeste tijd kosten.
 *
 * De ordernummers matchen de trajecten uit `migrations/0024_demo_catalogus.sql`,
 * zodat de agent echte lookups doet en de grounding-check iets te
 * verifiëren heeft.
 */

export interface DemoScenario {
  /** Stabiele sleutel; wordt de idempotency-key, dus opnieuw seeden dupliceert niet. */
  key: string;
  /** Waarom deze mail in de demo zit — getoond in het demo-paneel. */
  purpose: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = Object.freeze([
  {
    key: "status",
    purpose:
      "Statusvraag met ordernummer — toont de trajectlookup en de grounding-check op de mijlpalen.",
    from: "j.dekker@example.com",
    fromName: "Jeroen Dekker",
    subject: "Hoe ver staat onze implementatie?",
    body: [
      "Goedemiddag,",
      "",
      "We zijn eind juli gestart met traject DEMO-1001 en ik hoor intern de vraag",
      "wanneer we live gaan. Kunnen jullie me vertellen waar we nu staan?",
      "",
      "Met vriendelijke groet,",
      "Jeroen Dekker",
    ].join("\n"),
  },
  {
    key: "uitbreiding",
    purpose:
      "Wijziging op een lopend abonnement — laat zien hoe een beleidsregel de toon en de voorgestelde actie stuurt, en dat de agent het niet zelf doorvoert.",
    from: "m.vandenberg@example.com",
    fromName: "Marieke van den Berg",
    subject: "Ticketing erbij op DEMO-1002",
    body: [
      "Hallo,",
      "",
      "We draaien nu de chatbot met de kennisbank (DEMO-1002) en we willen de",
      "ticketing-module erbij. Kan dat per direct, en wat wordt dan het",
      "maandbedrag?",
      "",
      "Groet, Marieke",
    ].join("\n"),
  },
  {
    key: "klacht",
    purpose:
      "Geëmotioneerde klacht — demonstreert dat gevoelige mail altijd langs een mens gaat (needsHitl).",
    from: "p.jansen@example.com",
    fromName: "Peter Jansen",
    subject: "Zeer teleurgesteld over de afhandeling",
    body: [
      "Beste,",
      "",
      "Dit is inmiddels mijn derde mail over traject DEMO-1003 en ik krijg steeds",
      "geen antwoord. We hebben in juli getekend en er is nog geen aftrap geweest.",
      "Ik verwacht vandaag nog een reactie.",
      "",
      "Peter Jansen",
    ].join("\n"),
  },
  {
    key: "storing",
    purpose:
      "Storingsmelding bij een bestaande klant — routeert naar de technische specialist en moet de SLA-reactietermijn noemen.",
    from: "s.bakker@example.com",
    fromName: "Sanne Bakker",
    subject: "Chatbot geeft sinds vanochtend geen antwoord",
    body: [
      "Goedemorgen,",
      "",
      "De chatbot op onze site (traject DEMO-1002) reageert sinds vanochtend",
      "nergens meer op. De knop verschijnt wel, maar er komt niets terug.",
      "Wanneer kunnen jullie hiernaar kijken?",
      "",
      "Vriendelijke groet,",
      "Sanne Bakker",
    ].join("\n"),
  },
  {
    key: "prospect",
    purpose:
      "Prospect zonder traject — toont dat de agent over het assortiment kan praten zonder klantgegevens, en waar hij doorverwijst naar een mens.",
    from: "d.koster@example.com",
    fromName: "Daan Koster",
    subject: "Vraag over de mailagent",
    body: [
      "Hoi,",
      "",
      "We draaien Exact Online en Microsoft 365. Wat kost de mailagent bij ons",
      "ongeveer, en gaat er echt altijd iemand overheen voordat er iets naar een",
      "klant gaat?",
      "",
      "Daan Koster",
    ].join("\n"),
  },
  {
    key: "gdpr",
    purpose:
      "AVG-verzoek — toont het aparte privacy-pad met verplichte menselijke controle.",
    from: "r.smit@example.com",
    fromName: "Rob Smit",
    subject: "Verzoek verwijdering persoonsgegevens",
    body: [
      "Geachte heer/mevrouw,",
      "",
      "Ik wil dat jullie al mijn persoonsgegevens verwijderen en mij uitschrijven",
      "van de nieuwsbrief. Graag een bevestiging binnen de wettelijke termijn.",
      "",
      "Rob Smit",
    ].join("\n"),
  },
  {
    key: "samengesteld",
    purpose:
      "Twee vragen in één mail — laat de compound-flow zien: meerdere specialisten, één samengesteld antwoord.",
    from: "l.visser@example.com",
    fromName: "Linda Visser",
    subject: "Twee vragen",
    body: [
      "Hoi,",
      "",
      "Ten eerste: wanneer gaat traject DEMO-1002 over naar de maandelijkse",
      "bijsturing? En ten tweede: kunnen we op DEMO-1001 de kennisbank nog",
      "toevoegen voordat we live gaan?",
      "",
      "Dank alvast, Linda",
    ].join("\n"),
  },
  // ---------------------------------------------------------------------
  // Schrijfoperaties. Vier mails waarbij de agent niet alleen antwoordt maar
  // ook iets in een bronsysteem klaarzet.
  //
  // Let op de afzenders: die zijn steeds het adres dat in de demo-order bij dat
  // ordernummer staat. Dat is geen kosmetiek maar de voorwaarde — pas als het
  // bronsysteem het afzenderadres aan het ordernummer knoopt, komt de
  // identificatie op `gematcht` en mag er een schrijfactie ontstaan. Mail
  // dezelfde vraag vanaf een ander adres en je ziet de poort dichtgaan.
  // ---------------------------------------------------------------------
  {
    key: "creditnota",
    purpose:
      "Beschadigd geleverd — de agent zet een creditnota klaar op de factuur, met het bedrag herleidbaar naar de factuurregel. Onder de bedragsgrens, dus een medewerker mag 'm aftekenen.",
    from: "m.vandenberg@example.com",
    fromName: "Marieke van den Berg",
    subject: "Artikel beschadigd aangekomen — order DEMO-1002",
    body: [
      "Hallo,",
      "",
      "Het artikel uit order DEMO-1002 kwam gisteren beschadigd aan. De doos was",
      "ingedrukt en het product zelf heeft een barst. Ik heb er niks aan.",
      "Ik wil graag mijn geld terug voor dit artikel.",
      "",
      "Met vriendelijke groet,",
      "Marieke van den Berg",
    ].join("\n"),
  },
  {
    key: "adreswijziging",
    purpose:
      "Adreswijziging op een order die nog niet verzonden is. Toont de hervalidatie: wordt de order intussen verzonden, dan ketst het voorstel bij goedkeuren alsnog af.",
    from: "p.jansen@example.com",
    fromName: "Peter Jansen",
    subject: "Ander afleveradres voor DEMO-1003",
    body: [
      "Beste,",
      "",
      "Ik ben verhuisd en order DEMO-1003 moet naar mijn nieuwe adres:",
      "Nieuwstraat 44, 5611 EE Eindhoven.",
      "Kan dat nog worden aangepast?",
      "",
      "Peter Jansen",
    ].join("\n"),
  },
  {
    key: "onvolledige-levering",
    purpose:
      "Eén van twee artikelen ontbreekt — de agent zet een nalevering klaar voor precies het artikel dat mist, uit de orderregels.",
    from: "s.bakker@example.com",
    fromName: "Sanne Bakker",
    subject: "Pakket incompleet — order DEMO-1004",
    body: [
      "Goedemiddag,",
      "",
      "Ik heb order DEMO-1004 ontvangen, maar er zat maar één artikel in.",
      "Demoproduct B ontbreekt. Demoproduct A zat er wel bij.",
      "Kunnen jullie het ontbrekende artikel alsnog sturen?",
      "",
      "Groet, Sanne Bakker",
    ].join("\n"),
  },
  {
    key: "pakket-kwijt",
    purpose:
      "Pakket staat als onderweg maar komt niet aan — de agent zet een onderzoek bij de vervoerder klaar met de trackingcode uit de zending.",
    from: "j.dekker@example.com",
    fromName: "Jeroen Dekker",
    subject: "Pakket lijkt kwijt — order DEMO-1001",
    body: [
      "Goedemiddag,",
      "",
      "Order DEMO-1001 staat al ruim een week op 'in bezorging' en er beweegt",
      "niets meer in de track & trace. Ik vermoed dat het pakket kwijt is.",
      "Kunnen jullie dit navragen bij de vervoerder?",
      "",
      "Met vriendelijke groet,",
      "Jeroen Dekker",
    ].join("\n"),
  },
]);

/** Bouwt de Signal-payload zoals de mail-MCP 'm ook zou aanleveren. */
export function demoSignalPayload(s: DemoScenario): Record<string, unknown> {
  return {
    messageId: `demo-${s.key}`,
    conversationId: `demo-thread-${s.key}`,
    from: s.from,
    fromName: s.fromName,
    toEmail: s.from,
    subject: s.subject,
    bodyText: s.body,
    receivedDateTime: new Date().toISOString(),
    // Markeert de herkomst zodat de reset-actie precies deze items opruimt.
    demo: true,
  };
}
