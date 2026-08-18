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
 * De trajectnummers matchen de rijen uit `migrations/0035_demo_klantwereld.sql`,
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
  /**
   * Bijlagen bij deze mail.
   *
   * Staat hier en niet alleen bij een klant, want elke demo heeft 'm nodig:
   * `creditnota_voorstellen` eist beeldmateriaal, en zonder een mail die een
   * bijlage kán dragen is die poort niet te tonen. Dan lijkt het of de agent
   * nooit een creditnota voorstelt, en zie je alleen de helft waar niets
   * gebeurt.
   *
   * Er wordt geen bestand geüpload. De poort kijkt naar naam en content-type,
   * en dat is precies wat een echte mail ook meelevert.
   */
  attachments?: readonly DemoAttachment[];
}

/** Naam en type — meer heeft de fotopoort niet nodig. */
export interface DemoAttachment {
  name: string;
  contentType: string;
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
    from: "m.vandenberg@example.com",
    fromName: "Marieke van den Berg",
    subject: "Chatbot geeft sinds vanochtend geen antwoord",
    body: [
      "Goedemorgen,",
      "",
      "De chatbot op onze site (traject DEMO-1002) reageert sinds vanochtend",
      "nergens meer op. De knop verschijnt wel, maar er komt niets terug.",
      "Wanneer kunnen jullie hiernaar kijken?",
      "",
      "Vriendelijke groet,",
      "Marieke van den Berg",
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
      "Storing met bewijs — de agent zet een creditnota klaar op de maandregel van de module die eruit lag, met het bedrag herleidbaar naar de factuurregel. € 200 blijft onder de grens, dus een medewerker mag 'm aftekenen.",
    from: "r.smit@example.com",
    fromName: "Rob Smit",
    subject: "Ticketing lag er drie dagen uit — traject DEMO-1005",
    body: [
      "Hallo,",
      "",
      "De ticketingmodule op traject DEMO-1005 was van 14 tot en met 16 augustus",
      "onbereikbaar. Mijn team heeft die dagen alles op papier moeten bijhouden.",
      "Ik heb er schermafbeeldingen van; die stuur ik mee.",
      "",
      "Ik wil de maand augustus voor die module gecrediteerd zien.",
      "",
      "Met vriendelijke groet,",
      "Rob Smit",
    ].join("\n"),
    attachments: [
      { name: "storing-15-augustus.png", contentType: "image/png" },
      { name: "foutmelding.png", contentType: "image/png" },
    ],
  },
  {
    key: "creditnota-zonder-bewijs",
    purpose:
      "Dezelfde soort claim, zonder bijlage. Laat de fotopoort zien: de agent kán hier geen creditnota voorstellen en maakt er een werkticket van. Zet deze naast de vorige om te tonen dat de regel in de architectuur zit en niet in de prompt.",
    from: "m.vandenberg@example.com",
    fromName: "Marieke van den Berg",
    subject: "Chatbot deed het vorige week niet — DEMO-1002",
    body: [
      "Hallo,",
      "",
      "De chatbot op onze site (traject DEMO-1002) heeft vorige week een aantal",
      "dagen niet gewerkt. Ik vind het niet redelijk dat we daar de volle maand",
      "voor betalen.",
      "",
      "Graag de maand augustus crediteren.",
      "",
      "Groet, Marieke",
    ].join("\n"),
  },
  {
    key: "adreswijziging",
    purpose:
      "Adreswijziging op een traject dat nog niet is afgetrapt. Toont de hervalidatie: verschuift de fase intussen, dan ketst het voorstel bij goedkeuren alsnog af — probeer het door de status van DEMO-1003 te wijzigen vóór je goedkeurt.",
    from: "p.jansen@example.com",
    fromName: "Peter Jansen",
    subject: "Nieuw vestigingsadres voor DEMO-1003",
    body: [
      "Beste,",
      "",
      "Wij zijn verhuisd. Kunnen jullie het adres op traject DEMO-1003 aanpassen",
      "naar Nieuwstraat 44, 5611 EE Eindhoven? Dat is ook het adres waar de",
      "facturen naartoe moeten.",
      "",
      "Peter Jansen",
    ].join("\n"),
  },
  {
    key: "onvolledige-levering",
    purpose:
      "Eén van twee onderdelen uit het traject is nog niet opgeleverd — de agent zet een nalevering klaar voor precies dat onderdeel, uit de trajectregels.",
    from: "s.bakker@example.com",
    fromName: "Sanne Bakker",
    subject: "Kennisbank nog niet geleverd — traject DEMO-1004",
    body: [
      "Goedemiddag,",
      "",
      "In traject DEMO-1004 zit naast de documentagent ook de kennisbank. De",
      "documentagent draait sinds eind juli, maar van de kennisbank hebben we",
      "nog niets gezien terwijl hij wel op de factuur staat.",
      "Kunnen jullie dat alsnog inplannen?",
      "",
      "Groet, Sanne Bakker",
    ].join("\n"),
  },
  {
    key: "opzegging",
    purpose:
      "Opzegging van een traject dat nog niet is afgetrapt — onomkeerbaar aan klantzijde, dus mail-only en alleen bij een afzender die het bronsysteem aan het traject knoopt.",
    from: "p.jansen@example.com",
    fromName: "Peter Jansen",
    subject: "Traject DEMO-1003 stopzetten",
    body: [
      "Beste,",
      "",
      "We hebben intern besloten het niet door te zetten. Traject DEMO-1003 is",
      "nog niet afgetrapt, dus ik ga ervan uit dat we er nog vanaf kunnen.",
      "Graag stopzetten en bevestigen.",
      "",
      "Peter Jansen",
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
    // Alleen als er bijlagen zijn: een leeg array zou "we hebben gekeken en er
    // zit niets bij" betekenen. Dat is hier toevallig hetzelfde antwoord, maar
    // niet dezelfde uitspraak — en `hasPhoto` mag het verschil kunnen zien.
    ...(s.attachments ? { attachments: s.attachments.map((a) => ({ ...a })) } : {}),
    // Markeert de herkomst zodat de reset-actie precies deze items opruimt.
    demo: true,
  };
}
