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
 * De `orderNumber`-verwijzingen matchen de seed in de demo-migratie, zodat de
 * agent echte order/tracking-lookups doet en de grounding-check iets te
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
    key: "levertijd",
    purpose:
      "Simpele statusvraag met ordernummer — toont de order-lookup en de grounding-check op track & trace.",
    from: "j.dekker@example.com",
    fromName: "Jeroen Dekker",
    subject: "Waar blijft mijn bestelling?",
    body: [
      "Goedemiddag,",
      "",
      "Vorige week heb ik order DEMO-1001 geplaatst en ik heb nog niks ontvangen.",
      "Kunnen jullie me vertellen wanneer het geleverd wordt?",
      "",
      "Met vriendelijke groet,",
      "Jeroen Dekker",
    ].join("\n"),
  },
  {
    key: "retour",
    purpose:
      "Retouraanvraag binnen de termijn — laat zien hoe een beleidsregel de toon en de voorgestelde actie stuurt.",
    from: "m.vandenberg@example.com",
    fromName: "Marieke van den Berg",
    subject: "Retour aanmelden order DEMO-1002",
    body: [
      "Hallo,",
      "",
      "Ik wil graag een artikel uit order DEMO-1002 retourneren. Het voldoet niet",
      "aan wat ik verwachtte. Hoe pak ik dit aan?",
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
      "Dit is inmiddels mijn derde mail over order DEMO-1003 en ik krijg steeds",
      "geen antwoord. Ik vind dit ronduit slechte service en verwacht vandaag nog",
      "een reactie, anders stap ik naar de geschillencommissie.",
      "",
      "Peter Jansen",
    ].join("\n"),
  },
  {
    key: "technisch",
    purpose:
      "Technische vraag — routeert naar de technische specialist (zwaardere modeltier).",
    from: "s.bakker@example.com",
    fromName: "Sanne Bakker",
    subject: "Product werkt niet zoals verwacht",
    body: [
      "Goedemorgen,",
      "",
      "Ik heb het artikel uit order DEMO-1001 geïnstalleerd volgens de handleiding,",
      "maar het schakelt steeds na een paar minuten uit. Wat kan ik nog proberen?",
      "",
      "Vriendelijke groet,",
      "Sanne Bakker",
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
      "Ten eerste: wanneer wordt order DEMO-1002 geleverd?",
      "En ten tweede: ik wil op order DEMO-1001 het afleveradres wijzigen naar",
      "mijn werkadres. Kan dat nog?",
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
