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
