/**
 * De envelop — hoe de kern een signaal leest, ongeacht waar het vandaan komt.
 *
 * ## Waarom dit bestaat
 *
 * Tot fase 2 las de lus rechtstreeks mailvelden uit `signal.payload`:
 * `payload.from` om te bepalen of de klant geïdentificeerd was,
 * `payload.attachments` om te beslissen of een creditnota mocht ontstaan.
 * Daarmee was de kern een mailagent met een generieke naam. Een bankmutatie
 * heeft geen `from`, een openstaande post geen `attachments`, en een
 * geüpload document geen van beide — dus een tweede domein kwam de lus niet
 * door zonder net te doen alsof het een mail was.
 *
 * Een envelop is wat élk signaal heeft: een tekst, wie erbij betrokken zijn,
 * waar het naar verwijst, wat eraan hangt, en wanneer het gebeurde. De ruwe
 * payload blijft eraan hangen in `raw`, want die is het bewijsstuk — de
 * werkbak toont 'm, en een snapshot die is bijgewerkt is geen snapshot meer.
 *
 * ## Wie 'm maakt
 *
 * Een **hydrator** per domein. Die haalt op wat er nog niet is (bij mail de
 * volledige berichtinhoud, bij een upload straks de OCR) en leest het resultaat
 * als envelop. De registratie staat aan de rand, in de agent-Worker, want een
 * hydrator praat met MCP's en Storage. Zie `agents/mail-agent/src/hydrators/`.
 */

import type { Signal } from '../contracts/index.js';

/**
 * Wie er bij dit signaal betrokken is.
 *
 * `afzender` is de enige rol waar de kern iets mee doet: die bepaalt of de
 * klant geïdentificeerd is. De rest staat er voor de specialisten en het
 * beslislog — een cc'tje kan het verschil zijn tussen een interne mail en een
 * klantvraag.
 */
export interface EnvelopeParticipant {
  /** Adres, gebruikersnaam of id zoals het domein 'm aanlevert. */
  address: string;
  /** Weergavenaam, als het domein er een heeft. */
  name?: string;
  role: 'afzender' | 'ontvanger' | 'kopie';
}

/**
 * Wat er aan dit signaal hangt.
 *
 * `path` is gevuld zodra het bestand is veiliggesteld in Storage. Zolang dat
 * niet gelukt is, staat er waaróm in `note` — een bijlage die stil verdwijnt is
 * erger dan een bijlage waarvan zichtbaar is dat hij niet opgehaald kon worden.
 */
export interface EnvelopeAttachment {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  path?: string | null;
  note?: string;
}

/**
 * Eén signaal, zoals de kern het leest.
 *
 * Bewust smal: alles wat maar één domein heeft, hoort in `raw` en wordt gelezen
 * door de specialisten van dát domein. Komt er een veld bij, dan moet élke
 * hydrator het invullen — vraag eerst of `refs` niet volstaat.
 */
export interface SignalEnvelope {
  /** Onderwerp, als het domein er een kent. Een bankmutatie heeft er geen. */
  subject?: string;
  /** De tekst waar de poort en de classificatie op werken. Nooit undefined. */
  body: string;
  participants: EnvelopeParticipant[];
  /**
   * Identificerende verwijzingen: `orderNumber`, `invoiceNumber`, `ticketId`,
   * `messageId`. Alleen strings, want dit zijn sleutels waarmee je iets
   * opzoekt — geen gegevens.
   */
  refs: Record<string, string>;
  attachments: EnvelopeAttachment[];
  /** Wanneer het gebeurde volgens de bron, niet wanneer wij het zagen. */
  occurredAt: string;
  /**
   * De payload zoals het domein 'm aanleverde.
   *
   * Gaat als `proposed.original` mee naar het ReviewItem: dat is het
   * onveranderlijke bewijsstuk van wat de agent zag. De kern leest er niets
   * uit — dat is het hele punt van de envelop.
   */
  raw: Record<string, unknown>;
}

/**
 * Het afzenderadres, of null.
 *
 * De enige deelnemer waar de kern naar kijkt. Null en geen lege string: "geen
 * afzender bekend" en "een lege afzender" horen niet hetzelfde te zijn, want op
 * het eerste hoort de identificatie te falen.
 */
export function senderOf(envelope: SignalEnvelope): string | null {
  const afzender = envelope.participants.find((p) => p.role === 'afzender');
  const adres = afzender?.address?.trim();
  return adres ? adres : null;
}

/** Een verwijzing uit de envelop, of null als hij er niet is of leeg is. */
export function refOf(envelope: SignalEnvelope, naam: string): string | null {
  const waarde = envelope.refs[naam]?.trim();
  return waarde ? waarde : null;
}

/**
 * Een lege envelop rond een signaal.
 *
 * Voor domeinen die niets meer nodig hebben dan hun eigen payload, en als basis
 * in een hydrator die maar een paar velden invult. De payload gaat naar `raw`,
 * zodat het bewijsstuk hoe dan ook compleet is.
 */
export function baseEnvelope(signal: Signal): SignalEnvelope {
  return {
    body: '',
    participants: [],
    refs: {},
    attachments: [],
    occurredAt: signal.receivedAt,
    raw: (signal.payload ?? {}) as Record<string, unknown>,
  };
}

/**
 * Leest de string-velden van een object als `refs`.
 *
 * Niet-strings vallen weg: `refs` is een sleutelbos, en een genest object of
 * een getal is geen sleutel waarmee je iets opzoekt. Lege strings vallen ook
 * weg, want die zijn niet te onderscheiden van "niet meegegeven".
 */
export function refsFrom(
  bron: Record<string, unknown>,
  namen: readonly string[],
): Record<string, string> {
  const uit: Record<string, string> = {};
  for (const naam of namen) {
    const waarde = bron[naam];
    if (typeof waarde === 'string' && waarde.trim()) uit[naam] = waarde;
  }
  return uit;
}

// ---------------------------------------------------------------------------
// De hydrator-registry
// ---------------------------------------------------------------------------

/**
 * Wat een domein moet leveren om door de lus te mogen.
 *
 * Twee stappen, bewust apart. `hydrate` praat met de buitenwereld en mag falen;
 * `toEnvelope` is puur en mag dat niet. Zaten ze in één functie, dan zou een
 * mislukte MCP-call ook de envelop wegnemen, en dan valt de hele run om op iets
 * wat fail-soft hoort te zijn.
 */
export interface DomainHydrator {
  /** `signal.domain` waar deze hydrator voor is. */
  domain: string;
  /**
   * Haalt op wat het domein niet meestuurt.
   *
   * Bij mail de berichtinhoud (de MCP emit alleen een `messageId`), bij een
   * upload de tekst uit het document. **Fail-soft**: lukt het niet, geef dan
   * het signaal ongewijzigd terug en log waarom. Een agent die stilvalt is
   * erger dan een agent die één item naar review stuurt.
   *
   * Weglaten mag: dan is de payload al compleet.
   */
  hydrate?(signal: Signal): Promise<Signal>;
  /** Leest het (gehydrateerde) signaal als envelop. Puur, gooit nooit. */
  toEnvelope(signal: Signal): SignalEnvelope;
}

/**
 * Zoekt de hydrator voor dit domein.
 *
 * Null bij een onbekend domein, en dat is een **expliciet** resultaat. Er is
 * bewust geen generieke terugval die `payload.body` of `payload.text` probeert:
 * dat zou raden zijn, en een envelop die half klopt levert een poort op die op
 * een lege tekst oordeelt. Een nieuw domein hoort een hydrator te krijgen
 * vóórdat er signalen van binnenkomen.
 */
export function hydratorFor(
  hydrators: readonly DomainHydrator[],
  domain: string,
): DomainHydrator | null {
  return hydrators.find((h) => h.domain === domain) ?? null;
}
