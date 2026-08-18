/**
 * Voorgestelde acties — een schrijfoperatie in een bronsysteem, klaargezet maar
 * niet uitgevoerd.
 *
 * ## Het principe waar alles op rust
 *
 * **De actie bestaat niet totdat een mens goedkeurt.** Er staat niets in het
 * bronsysteem tot dat moment: geen concept-order, geen creditnota in status
 * "voorstel", geen werkticket dat productie al ziet staan.
 *
 * Dat is geen voorzichtigheid maar een ontwerpkeuze met een concreet gevolg: er
 * is geen terugdraaipad nodig, want er valt niets terug te draaien. Geen
 * compensatiestappen, geen sagas, geen statusverschil tussen ons en de klant.
 * De hele klasse fouten waar orderautomatisering normaal op stukloopt, bestaat
 * hier niet.
 *
 * De prijs staat er tegenover en is echt: een voorstel kan verouderen tussen
 * voorstellen en goedkeuren. Dat is wat `precondition` en de hervalidatie bij
 * goedkeuring afdekken — zie `ActionTypeDef.preconditionKind`.
 *
 * ## Waarom dit een eigen object is en geen veld op het ReviewItem
 *
 * Eén run kan meerdere acties opleveren, en een actie kan bestaan zonder
 * bijbehorend concept-antwoord. Als veld op het ReviewItem zou het eerste niet
 * passen en het tweede een leeg antwoord vereisen.
 *
 * In de werkbak horen ze wél op één scherm als ze uit dezelfde run komen — die
 * koppeling loopt via `runId`/`reviewItemId`, niet via nesting.
 *
 * ## Wat hier NIET in zit
 *
 * Uitvoering. Deze module beschrijft en bewaakt; het schrijven gebeurt in de
 * MCP-laag en het aanroepen in een Workflow ná goedkeuring. Dat is dezelfde
 * scheiding als bij de rest: de kern beslist, de MCP doet.
 */

import type { ChannelId } from '../channels/index.js';

// ---------------------------------------------------------------------------
// Identificatie
// ---------------------------------------------------------------------------

/**
 * Hoe zeker weten we wie dit vraagt.
 *
 * Het onderscheid bestaat omdat "mailadres plus ordernummer" géén
 * authenticatie is: beide staan op de pakbon, in de bevestigingsmail en soms op
 * het pakket zelf. Dat is bezit van een papiertje.
 *
 * Voor een leesactie is dat te verdedigen — iemands orderstatus voorlezen aan
 * de verkeerde persoon is vervelend. Voor een schrijfactie niet: een adres
 * wijzigen op een verzonden order is precies de vector waar pakketfraude op
 * draait, en dan is het schade in plaats van ongemak.
 */
export const IDENTIFICATION_LEVELS = ['zwak', 'gematcht', 'bevestigd'] as const;
export type IdentificationLevel = (typeof IDENTIFICATION_LEVELS)[number];

/** Van zwak naar sterk, zodat "minimaal" een vergelijking is en geen lijstje. */
const IDENTIFICATION_RANK: Readonly<Record<IdentificationLevel, number>> = Object.freeze({
  zwak: 0,
  gematcht: 1,
  bevestigd: 2,
});

/** Voldoet `have` aan de eis `required`? */
export function identificationSuffices(
  have: IdentificationLevel,
  required: IdentificationLevel,
): boolean {
  return IDENTIFICATION_RANK[have] >= IDENTIFICATION_RANK[required];
}

/**
 * De feiten waaruit het identificatieniveau volgt.
 *
 * Bewust feiten en geen oordeel. Het model mag niet zelf melden hoe zeker het
 * van de klant is — dat is precies de bewering die je niet aan een model wil
 * overlaten als er een creditnota aan hangt. De lus leidt het niveau af uit wat
 * er daadwerkelijk is opgehaald.
 */
export interface IdentityEvidence {
  /** Afzender zoals het kanaal 'm aanleverde. Bij mail: het From-adres. */
  senderAddress?: string | null;
  /** Ordernummer uit het bericht of de classificatie. */
  orderReference?: string | null;
  /**
   * Het adres dat in het bronsysteem bij die order staat. Alleen gevuld als de
   * lookup daadwerkelijk iets teruggaf — een mislukte call is `null`, geen
   * lege string, want "niet gevonden" en "leeg veld" zijn niet hetzelfde.
   */
  sourceEmail?: string | null;
  /**
   * Heeft de klant in deze run actief bevestigd dat hij het is (klik op een
   * eenmalige link, code uit een tweede kanaal)?
   *
   * Vandaag bestaat dat mechanisme nog niet en staat dit dus altijd op false.
   * Dat is geen omissie maar de rem die werkt: actietypen die `bevestigd`
   * eisen, ontstaan simpelweg niet. Liever een type dat nog niet kan dan een
   * type dat kan op grond van een adres dat op de pakbon staat.
   */
  confirmed?: boolean;
}

function normaliseerAdres(waarde: string | null | undefined): string | null {
  const t = (waarde ?? '').trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/**
 * Leidt het identificatieniveau af uit de feiten van deze run.
 *
 * De trap:
 *
 *   bevestigd  de klant heeft actief bevestigd dat hij het is
 *   gematcht   het opgegeven ordernummer is teruggevonden én het adres dat
 *              daarbij in het bronsysteem staat, is het adres waar dit bericht
 *              vandaan komt
 *   zwak       al het overige
 *
 * `gematcht` vraagt om die twee samen, en niet om één ervan. Een ordernummer
 * alleen is bezit van een papiertje: het staat op de pakbon, in de
 * bevestigingsmail en soms op het pakket. Een adres alleen zegt niets over
 * wélke order het gaat. Pas als het bronsysteem bevestigt dat die twee bij
 * elkaar horen, is er iets tegen een bron gehouden.
 *
 * Bij chat weegt dat lichter dan bij mail — daar typt de bezoeker het From-adres
 * zelf in plaats van dat een mailsysteem het aanlevert. Dat verschil zit niet
 * hier maar in `ACTION_TYPES.channels`: de gevaarlijke typen staan op chat
 * gewoon uit.
 */
export function identificationLevel(evidence: IdentityEvidence): IdentificationLevel {
  if (evidence.confirmed === true) return 'bevestigd';
  const afzender = normaliseerAdres(evidence.senderAddress);
  const bron = normaliseerAdres(evidence.sourceEmail);
  const order = (evidence.orderReference ?? '').trim();
  if (order.length > 0 && afzender !== null && bron !== null && afzender === bron) {
    return 'gematcht';
  }
  return 'zwak';
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const ACTION_STATUSES = [
  'voorgesteld',
  'goedgekeurd',
  'uitgevoerd',
  'afgewezen',
  'verlopen',
  'mislukt',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * Toegestane overgangen.
 *
 * Twee dingen zijn hier bewust:
 *
 * `goedgekeurd → verlopen` bestaat, want dat is precies wat hervalidatie doet:
 * iemand drukt op goedkeuren, de preconditie blijkt niet meer te kloppen, en
 * dan gaat het geval terug de wachtrij in in plaats van uitgevoerd te worden.
 *
 * `mislukt → goedgekeurd` bestaat óók. Een uitvoering die halverwege omvalt op
 * een netwerkfout mag opnieuw; de idempotentiesleutel voorkomt dat dat dubbel
 * schrijft. Zonder deze overgang zou elke tijdelijke storing een voorstel
 * definitief weggooien.
 *
 * `uitgevoerd` is eindstation. Er staat dan iets in een systeem van iemand
 * anders; die rij is historie, geen werkvoorraad.
 */
const ACTION_TRANSITIONS: Readonly<Record<ActionStatus, readonly ActionStatus[]>> = Object.freeze({
  voorgesteld: ['goedgekeurd', 'afgewezen', 'verlopen'],
  goedgekeurd: ['uitgevoerd', 'mislukt', 'verlopen'],
  uitgevoerd: [],
  afgewezen: [],
  verlopen: [],
  mislukt: ['goedgekeurd', 'afgewezen'],
});

export function canTransitionAction(from: ActionStatus, to: ActionStatus): boolean {
  return ACTION_TRANSITIONS[from].includes(to);
}

/** Statussen waarin nog iets van een mens wordt verwacht. Voedt de werkbak. */
export function isOpenAction(status: ActionStatus): boolean {
  return status === 'voorgesteld' || status === 'mislukt';
}

// ---------------------------------------------------------------------------
// Onderbouwing per veld
// ---------------------------------------------------------------------------

/**
 * Waar één veld in de payload vandaan komt.
 *
 * Bij een concept-antwoord kun je wegkomen met onderbouwing op berichtniveau.
 * Bij een creditnota van 340 euro moet zichtbaar zijn waar de 340 vandaan komt
 * én waar het factuurnummer vandaan komt. Dat is dezelfde grondingsregel,
 * alleen strenger toegepast: elk veld in de payload is een feitelijke bewering.
 */
export interface FieldEvidence {
  /** Puntnotatie in de payload, bv. `address.postalCode` of `lines.0.amount`. */
  field: string;
  /**
   * De tool-call uit dezelfde run die deze waarde dekt. Verplicht voor velden
   * die een bewering over een bronsysteem zijn (`source: 'bron'`).
   */
  toolCallId?: string;
  /**
   * Het bronbericht waarin de klant dit opgaf. Volstaat voor velden die de
   * klant zelf aanlevert (`source: 'bericht'`) — een nieuw adres of de reden
   * van een klacht staat in geen enkel systeem, want dat is nu juist wat hij
   * komt melden.
   */
  messageId?: string;
}

/**
 * Waar een payload-veld vandaan hoort te komen.
 *
 * Dit onderscheid ontbrak, en dat had een concreet gevolg: elk veld moest uit
 * een tool-call komen, dus een werkticket met een omschrijving uit de klantmail
 * ketste af op zijn eigen omschrijving. Juist het type dat bedoeld was om de
 * machinerie op te beproeven, kon nooit ontstaan.
 *
 *   bron     een bewering over een systeem — een bedrag, een factuurnummer,
 *            een orderstatus. Hier geldt harde regel 4 onverkort: geen
 *            tool-call uit dezelfde run, geen voorstel.
 *   bericht  iets wat de klant zelf aanlevert — een nieuw adres, de reden van
 *            een retour. Dat staat in geen enkel systeem; eisen dat het uit een
 *            bron komt is niet strenger maar onmogelijk.
 *
 * Het onderscheid is niet cosmetisch. Bij een creditnota is het precies de
 * scheidslijn die ertoe doet: het bedrag komt uit de factuur, de reden uit de
 * mail. Ze door elkaar halen betekent óf een verzonnen bedrag toelaten, óf geen
 * enkele creditnota kunnen voorstellen.
 */
export type PayloadFieldSource = 'bron' | 'bericht';

/**
 * Welke payload-velden missen dekking.
 *
 * Genest en array-velden worden platgeslagen tot puntnotatie, zodat een
 * bedrag diep in een regel niet ongemerkt ongegrond blijft.
 */
export function ungroundedFields(
  payload: Record<string, unknown>,
  evidence: readonly FieldEvidence[],
): string[] {
  const gedekt = new Set(evidence.map((e) => e.field));
  return leafPaths(payload).filter((pad) => !gedekt.has(pad));
}

/**
 * Zet een correctie van een medewerker op de payload.
 *
 * Alleen velden die in de registratie als `editable` staan. Alles daarbuiten
 * wordt geweigerd en niet genegeerd: stilzwijgend laten vallen zou betekenen
 * dat iemand een factuurnummer aanpast, "opgeslagen" ziet, en er iets anders
 * wordt uitgevoerd dan hij dacht.
 *
 * Een lege of onleesbare waarde is ook een weigering. Een creditnota met een
 * leeg bedrag is geen correctie maar een kapot voorstel.
 */
export function applyActionEdits(
  def: ActionTypeDef,
  payload: Record<string, unknown>,
  edits: Record<string, unknown>,
): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string } {
  const velden = new Map(def.payloadFields.map((v) => [v.name, v]));
  const uit: Record<string, unknown> = JSON.parse(JSON.stringify(payload));

  for (const [naam, rauw] of Object.entries(edits)) {
    const veld = velden.get(naam);
    if (!veld) return { ok: false, reason: `onbekend veld: ${naam}` };
    if (!veld.editable) {
      return {
        ok: false,
        reason:
          `${veld.label} is niet te wijzigen. Een ander record aanwijzen is geen ` +
          `correctie maar een andere actie — die hoort een eigen voorstel te krijgen`,
      };
    }

    // Het type volgt de bestaande waarde. Een bedrag dat als tekst binnenkomt
    // uit een formulierveld hoort een getal te blijven; anders schrijft de
    // uitvoerder een string in een numerieke kolom.
    const huidig = leesPad(uit, naam);
    let waarde: unknown = rauw;
    if (typeof huidig === 'number') {
      const n = typeof rauw === 'number' ? rauw : Number(String(rauw).replace(',', '.'));
      if (!Number.isFinite(n)) return { ok: false, reason: `${veld.label} is geen geldig getal` };
      if (n <= 0) return { ok: false, reason: `${veld.label} moet groter dan nul zijn` };
      waarde = n;
    } else {
      const t = String(rauw ?? '').trim();
      if (t.length === 0) return { ok: false, reason: `${veld.label} mag niet leeg zijn` };
      waarde = t;
    }
    schrijfPad(uit, naam, waarde);
  }
  return { ok: true, payload: uit };
}

/** Leest een waarde op puntnotatie. */
function leesPad(obj: Record<string, unknown>, pad: string): unknown {
  return pad.split('.').reduce<unknown>((acc, deel) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[deel];
  }, obj);
}

/** Schrijft een waarde op puntnotatie; maakt tussenliggende objecten aan. */
function schrijfPad(obj: Record<string, unknown>, pad: string, waarde: unknown): void {
  const delen = pad.split('.');
  let cursor: Record<string, unknown> = obj;
  for (const deel of delen.slice(0, -1)) {
    if (cursor[deel] === null || typeof cursor[deel] !== 'object') cursor[deel] = {};
    cursor = cursor[deel] as Record<string, unknown>;
  }
  cursor[delen[delen.length - 1]] = waarde;
}

export interface FieldBackingProblem {
  field: string;
  reason: string;
}

/**
 * Toetst per payload-veld of de dekking klopt bij waar het veld vandaan hoort.
 *
 * Strenger dan `ungroundedFields` op bron-velden en soepeler op bericht-velden,
 * en dat is precies de bedoeling: een bedrag zonder tool-call is een verzonnen
 * bedrag, maar een reden zonder tool-call is gewoon wat de klant schreef.
 *
 * Een veld dat niet in de registratie staat wordt als `bron` behandeld. Een
 * vergeten declaratie hoort de eis niet stilzwijgend te versoepelen — dat is
 * het soort gat waar je pas achterkomt als er iets verkeerds is weggeschreven.
 */
export function checkFieldBacking(
  payload: Record<string, unknown>,
  evidence: readonly FieldEvidence[],
  fields: readonly ActionPayloadField[],
): FieldBackingProblem[] {
  const dekking = new Map(evidence.map((e) => [e.field, e]));
  const herkomst = new Map(fields.map((f) => [f.name, f.source ?? 'bron']));

  const uit: FieldBackingProblem[] = [];
  for (const pad of leafPaths(payload)) {
    // Een berichtveld hoeft niets te bewijzen.
    //
    // Er is precies één bericht in een run, dus een verwijzing ernaar voegt
    // geen informatie toe — hij is altijd dezelfde. Hem tóch eisen levert
    // alleen een faalpad op: vergeet het model die ene regel, dan sneuvelt een
    // verder correct voorstel op een formaliteit. Dat is één keer gebeurd, en
    // de logregel wees naar het model terwijl het ontwerp de fout was.
    //
    // De harde eis blijft staan waar hij iets betekent: een getal of een
    // identifier die uit een systeem komt, moet aanwijsbaar uit dát systeem
    // komen.
    if ((herkomst.get(pad) ?? 'bron') === 'bericht') continue;

    const bewijs = dekking.get(pad);
    if (!bewijs?.toolCallId) {
      uit.push({
        field: pad,
        reason: bewijs
          ? 'alleen een verwijzing naar het bericht; dit veld moet uit een tool-call van deze run komen'
          : 'geen tool-call uit deze run die deze waarde dekt',
      });
    }
  }
  return uit;
}

function leafPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => leafPaths(v, prefix ? `${prefix}.${i}` : String(i)));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    // Een leeg object is zelf het blad — anders verdwijnt het uit de controle.
    if (entries.length === 0) return prefix ? [prefix] : [];
    return entries.flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return prefix ? [prefix] : [];
}

// ---------------------------------------------------------------------------
// Typeregistratie
// ---------------------------------------------------------------------------

/**
 * Wat er bij goedkeuring opnieuw wordt opgehaald en vergeleken.
 *
 * Bewust een kleine, gesloten lijst: de preconditie moet toetsbaar zijn, en
 * "toetsbaar" betekent dat er code is die 'm kan ophalen. Vrije tekst zou een
 * preconditie opleveren die niemand controleert.
 */
export const PRECONDITION_KINDS = ['orderstatus', 'factuurstatus', 'geen'] as const;
export type PreconditionKind = (typeof PRECONDITION_KINDS)[number];

/**
 * Welke velden een preconditie van dit soort mag bevatten.
 *
 * Dit is geen documentatie maar een filter, en het bestaat om een concrete
 * fout. Het model mag `precondition` zelf vullen, en het vulde er een veld in
 * dat geen enkele lookup teruggeeft (`phase`). Bij goedkeuring vergelijkt
 * `preconditionDrift` dat veld met `undefined`, ziet een verschil, en zet het
 * voorstel op `verlopen` — elke keer, zonder dat er iets veranderd is.
 *
 * Een preconditie die niet toetsbaar is, is erger dan geen preconditie: hij
 * ziet eruit als een controle en werkt als een blokkade. Wat de lookup niet kan
 * teruggeven, hoort er dus niet in te staan.
 *
 * Deze lijst moet gelijk lopen met wat de `PreconditionReader` van dit soort
 * teruggeeft. Loopt hij achter, dan verdwijnt een controle stilzwijgend; loopt
 * hij voor, dan ketst elk voorstel af.
 */
export const PRECONDITION_FIELDS: Readonly<Record<PreconditionKind, readonly string[]>> =
  Object.freeze({
    orderstatus: ['orderNumber', 'status', 'trackingCode'],
    factuurstatus: ['invoiceNumber', 'status', 'totalValue'],
    geen: [],
  });

/**
 * Houdt alleen de velden over die bij dit soort preconditie toetsbaar zijn.
 *
 * Wegfilteren en niet weigeren: een verzonnen veld zegt niets over de rest van
 * het voorstel, en een verder correcte adreswijziging laten sneuvelen op een
 * sleutel die het model erbij bedacht, is een strengheid die niemand helpt.
 */
export function filterPrecondition(
  kind: PreconditionKind,
  precondition: Record<string, unknown>,
): Record<string, unknown> {
  const toegestaan = new Set(PRECONDITION_FIELDS[kind]);
  return Object.fromEntries(
    Object.entries(precondition).filter(([veld]) => toegestaan.has(veld)),
  );
}

/**
 * Eén geregistreerd actietype. De agent kiest hieruit; hij bedenkt geen nieuwe
 * operaties.
 *
 * Dat is het verschil tussen een agent die handelt binnen afgesproken grenzen
 * en een agent die zelf verzint wat hij in andermans systeem gaat schrijven.
 */
export interface ActionTypeDef {
  /** Stabiele sleutel. Verandert nooit — voorstellen en historie hangen eraan. */
  slug: string;
  /** Voor het scherm. */
  label: string;
  /** Welke MCP en welke tool dit uitvoert, ná goedkeuring. */
  target: { mcp: string; tool: string };
  /** Wat er opnieuw wordt getoetst bij goedkeuring. */
  preconditionKind: PreconditionKind;
  /** Uit welke kanalen dit type mag ontstaan. */
  channels: readonly ChannelId[];
  /** Minimale identificatie voordat het voorstel überhaupt mag ontstaan. */
  requiredIdentification: IdentificationLevel;
  /** Minimale rol die dit mag goedkeuren. */
  approverRole: 'reviewer' | 'admin';
  /**
   * Vereist dit type dat de klant zelf beeldmateriaal heeft meegestuurd?
   *
   * Een harde poort en geen beleidsregel, en dat onderscheid is hier het punt.
   * Een beleidsregel is adviserend: hij gaat de prompt in, en een model kan
   * eromheen redeneren of hem simpelweg missen. Bij "crediteer 340 euro omdat
   * de klant zegt dat het kapot is" mag dat niet kunnen.
   *
   * Zonder foto is de schade een bewering van de klant en verder niets. Dat is
   * een prima reden om te antwoorden en om erom te vragen — maar geen reden om
   * geld terug te boeken. De agent stelt dan geen actie voor, en de reden komt
   * in het beslislog te staan zodat zichtbaar is dát hij het overwoog.
   */
  requiresPhoto?: boolean;
  /**
   * Boven dit bedrag (in euro) is `admin` vereist, ongeacht `approverRole`.
   * Weglaten = geen bedragsgrens. De drempel zelf is een tenant-instelling; dit
   * is de standaard.
   */
  amountThreshold?: number;
  /** Hoe lang een voorstel geldig blijft. Daarna: verlopen. */
  expiresAfterMinutes: number;
  /**
   * De velden die de payload moet bevatten.
   *
   * Eén lijst die twee dingen voedt: wat het model mag invullen (de prompt
   * wordt hieruit opgebouwd) en hoe een veld heet voor een mens (de modal toont
   * "Bedrag", niet `amount`). Bewust niet twee lijsten — die lopen uit elkaar,
   * en dan staat er in het goedkeurscherm een ander veld dan de agent invulde.
   */
  payloadFields: readonly ActionPayloadField[];
}

export interface ActionPayloadField {
  /** Sleutel in de payload, in puntnotatie voor geneste velden. */
  name: string;
  /** Kop in het goedkeurscherm. */
  label: string;
  /** Wat hier hoort te staan — gaat letterlijk de prompt in. */
  hint: string;
  /**
   * Waar de waarde vandaan hoort te komen. Bepaalt welke dekking volstaat.
   *
   * Ontbreekt hij, dan geldt `bron` — de strengste. Een vergeten veld hoort de
   * eis niet stilzwijgend te versoepelen.
   */
  source?: PayloadFieldSource;
  /**
   * Mag een medewerker deze waarde corrigeren vóór goedkeuring?
   *
   * De grens loopt niet langs "bron of bericht" maar langs iets anders: je mag
   * een **grootheid of een tekst** corrigeren, je mag de actie niet op een
   * **ander record** richten.
   *
   * Een reviewer die op de foto ziet dat één van twee artikelen kapot is, hoort
   * € 89 naar € 45 te kunnen bijstellen. Dat is precies waar een menselijke
   * controle voor is; hem dwingen af te wijzen en te wachten tot de agent het
   * opnieuw probeert, maakt van de goedkeuringslaag een obstakel.
   *
   * Een factuurnummer of een SKU aanpassen is iets anders. Dat is geen correctie
   * maar een andere actie, en dan hoort er een nieuw voorstel te komen met een
   * eigen onderbouwing en een eigen preconditie. Bovendien is de preconditie op
   * dat identificerende veld gebaseerd; hem wijzigen zou de hervalidatie op de
   * verkeerde rij laten kijken.
   *
   * Ontbreekt hij, dan is het veld NIET bewerkbaar. Een vergeten declaratie
   * hoort niets open te zetten.
   */
  editable?: boolean;
}

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
export const ACTION_TYPES: readonly ActionTypeDef[] = Object.freeze([
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

export const ACTION_TYPE_SLUGS: readonly string[] = Object.freeze(
  ACTION_TYPES.map((t) => t.slug),
);

export function getActionType(slug: string): ActionTypeDef | undefined {
  return ACTION_TYPES.find((t) => t.slug === slug);
}

/**
 * De typen die in deze situatie überhaupt kunnen ontstaan.
 *
 * Hiermee wordt de prompt opgebouwd. Een type dat toch zou afketsen niet
 * noemen scheelt niet alleen tokens: een model dat een creditnota voorstelt
 * die vervolgens wordt geweigerd, schrijft er meestal ook een antwoord bij
 * waarin het de klant dat bedrag belooft.
 *
 * Dit is een hulpmiddel voor de prompt, geen vervanging van de poort.
 * `buildProposedActions` toetst alles alsnog — een model dat een type noemt dat
 * hier niet in stond, komt daar niet doorheen.
 */
export function proposableActionTypes(input: {
  channel: ChannelId;
  identification: IdentificationLevel;
  /**
   * De bijlagen bij dit bericht. Laat 'm weg als het kanaal geen bijlagen kent;
   * typen die beeldmateriaal eisen vallen dan af, en dat is de veilige kant.
   */
  attachments?: readonly ActionAttachment[];
}): ActionTypeDef[] {
  const foto = hasPhoto(input.attachments);
  return ACTION_TYPES.filter(
    (t) =>
      t.channels.includes(input.channel) &&
      identificationSuffices(input.identification, t.requiredIdentification) &&
      (!t.requiresPhoto || foto),
  );
}

// ---------------------------------------------------------------------------
// Het object
// ---------------------------------------------------------------------------

export interface ProposedAction {
  id: string;
  organizationId: string;
  /** Slug uit `ACTION_TYPES`. */
  type: string;
  /** De volledige, uitvoerbare aanroep — niet een beschrijving ervan. */
  payload: Record<string, unknown>;
  /** Per veld in de payload: waar het vandaan komt. */
  evidence: FieldEvidence[];
  /**
   * De systeemstaat waarop dit voorstel is gebaseerd, in toetsbare vorm.
   * Bv. `{ orderNumber: 'DEMO-1001', status: 'pending' }`.
   */
  precondition: Record<string, unknown>;
  /** Wat er verandert, in mensentaal. Dit is wat het scherm groot toont. */
  impact: string;
  status: ActionStatus;
  /** De run die dit voortbracht — koppelt aan het beslislog. */
  runId: string;
  /** Het concept-antwoord uit dezelfde run, als dat er is. */
  reviewItemId?: string | null;
  /** Sleutel die naar het doelsysteem meegaat; voorkomt dubbel schrijven. */
  idempotencyKey: string;
  /** Reden bij afwijzen (leersignaal), of de fout bij mislukt/verlopen. */
  reason?: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * Wat de plan-stap voorstelt, vóór validatie.
 *
 * Dit is het enige wat het model over een actie mag zeggen: welk geregistreerd
 * type, met welke payload, waar elk veld vandaan komt, en waarop het voorstel
 * is gebaseerd. Het mag geen niveau, geen goedkeurder en geen vervaldatum
 * noemen — dat zijn de dingen die het zou kunnen gebruiken om zijn eigen
 * poorten open te zetten. Die vult `buildProposedActions` in vanuit de
 * registratie.
 */
export interface PlannedAction {
  /** Slug uit `ACTION_TYPES`. Een onbekende slug wordt geweigerd, niet gemaakt. */
  type: string;
  payload: Record<string, unknown>;
  evidence: FieldEvidence[];
  precondition: Record<string, unknown>;
  /** Wat er verandert, in mensentaal. Dit is wat het scherm groot toont. */
  impact: string;
}

export interface ActionProposalInput {
  planned: readonly PlannedAction[];
  channel: ChannelId;
  identification: IdentificationLevel;
  organizationId: string;
  /** De run die dit voortbracht — in de praktijk het signal-id. */
  runId: string;
  reviewItemId?: string | null;
  now: Date;
  /**
   * De bijlagen die bij dit bericht binnenkwamen. Nodig voor typen die
   * beeldmateriaal eisen; laat 'm weg als het kanaal geen bijlagen kent.
   */
  attachments?: readonly ActionAttachment[];
}

/** Wat we van een bijlage moeten weten om 'm te kunnen beoordelen. */
export interface ActionAttachment {
  name?: string;
  contentType?: string;
}

/** Beeldextensies, voor mailclients die alles als octet-stream versturen. */
const BEELD_EXTENSIES = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif'];

/**
 * Zit er beeldmateriaal bij?
 *
 * Kijkt naar het content-type én naar de bestandsnaam. Dat tweede is geen
 * overdaad: genoeg mailclients versturen een foto als `application/octet-stream`,
 * en dan zou een terechte claim afketsen op een header die de klant niet in de
 * hand heeft.
 *
 * Een PDF telt niet mee. Dat is meestal een factuur of een pakbon — nuttig, maar
 * geen bewijs van schade.
 */
export function hasPhoto(attachments: readonly ActionAttachment[] = []): boolean {
  return attachments.some((a) => {
    if ((a.contentType ?? '').toLowerCase().startsWith('image/')) return true;
    const naam = (a.name ?? '').toLowerCase();
    return BEELD_EXTENSIES.some((ext) => naam.endsWith(ext));
  });
}

/** Een voorstel dat niet is doorgegaan, met de reden. Gaat het beslislog in. */
export interface RejectedProposal {
  type: string;
  reason: string;
}

export interface ActionProposalResult {
  actions: ProposedAction[];
  /**
   * De geweigerde voorstellen. Deze lijst is de reden dat dit een resultaat is
   * en geen filter: zonder de redenen staat er straks "geen actie voorgesteld"
   * in de werkbak en kan niemand zien waaróm niet — en dan lijkt een poort die
   * z'n werk doet op een agent die niets kan.
   */
  rejected: RejectedProposal[];
}

/**
 * Zet voorstellen van de plan-stap om in gevalideerde `ProposedAction`s.
 *
 * Drie poorten, in deze volgorde:
 *
 *   1. **Mag dit type hier ontstaan** — `mayProposeAction`: bestaat het type,
 *      staat het aan op dit kanaal, is de identificatie sterk genoeg.
 *   2. **Is elk payload-veld gedekt** — `ungroundedFields`. Elk veld is een
 *      feitelijke bewering, en een bedrag zonder dekking is precies het geval
 *      waarvoor harde regel 4 bestaat.
 *   3. **Is er een impact-tekst** — zonder die zin staat er in de modal een
 *      knop waarvan niemand kan zien wat hij doet.
 *
 * Een gezakt voorstel wordt **niet afgezwakt maar geweigerd**. Een creditnota
 * met één ongedekt bedrag half doorlaten is geen halve fout; het is dezelfde
 * fout met een geruststellender scherm eromheen.
 *
 * ## Idempotentie
 *
 * `id` en `idempotencyKey` zijn afgeleid van de run en de positie in de lijst,
 * niet van een teller of toeval. Een Workflow-step mag opnieuw draaien; met een
 * willekeurig id zou dat een tweede voorstel opleveren voor dezelfde actie, en
 * dan staan er twee creditnota's van 340 euro in de werkbak.
 */
export function buildProposedActions(input: ActionProposalInput): ActionProposalResult {
  const actions: ProposedAction[] = [];
  const rejected: RejectedProposal[] = [];

  input.planned.forEach((voorstel, index) => {
    const poort = mayProposeAction({
      type: voorstel.type,
      channel: input.channel,
      identification: input.identification,
    });
    if (!poort.ok) {
      rejected.push({ type: voorstel.type, reason: poort.reason });
      return;
    }

    if (poort.def.requiresPhoto && !hasPhoto(input.attachments)) {
      rejected.push({
        type: voorstel.type,
        reason:
          'geen foto van de klant meegestuurd; schade zonder beeld is een bewering ' +
          'en geen grond om geld terug te boeken',
      });
      return;
    }

    const problemen = checkFieldBacking(
      voorstel.payload,
      voorstel.evidence,
      poort.def.payloadFields,
    );
    if (problemen.length > 0) {
      rejected.push({
        type: voorstel.type,
        reason: problemen.map((p) => `${p.field}: ${p.reason}`).join('; '),
      });
      return;
    }

    const impact = voorstel.impact.trim();
    if (impact.length === 0) {
      rejected.push({
        type: voorstel.type,
        reason: 'geen impact-omschrijving — dan kan een mens niet zien waar hij ja tegen zegt',
      });
      return;
    }

    const vervalt = new Date(
      input.now.getTime() + poort.def.expiresAfterMinutes * 60 * 1000,
    );
    // Stabiel op (run, positie): een herhaalde step levert dezelfde rij op in
    // plaats van een tweede voorstel.
    const sleutel = `${input.runId}-${index}`;
    actions.push({
      id: `pa_${sleutel}`,
      organizationId: input.organizationId,
      type: poort.def.slug,
      payload: voorstel.payload,
      evidence: voorstel.evidence,
      // Alleen wat de hervalidatie straks daadwerkelijk kan ophalen. Zie
      // `filterPrecondition`: een niet-toetsbare sleutel laat het voorstel bij
      // goedkeuring gegarandeerd verlopen.
      precondition: filterPrecondition(poort.def.preconditionKind, voorstel.precondition),
      impact,
      status: 'voorgesteld',
      runId: input.runId,
      reviewItemId: input.reviewItemId ?? null,
      idempotencyKey: `act-${sleutel}`,
      createdAt: input.now.toISOString(),
      expiresAt: vervalt.toISOString(),
    });
  });

  return { actions, rejected };
}

/**
 * Mag dit type hier ontstaan?
 *
 * Alle drie de poorten in één antwoord, want ze horen bij elkaar: een type dat
 * op een kanaal uitstaat ontstaat daar niet, ook niet met een bevestigde
 * identificatie, en een bekend type met te zwakke identificatie ontstaat
 * evenmin.
 *
 * Geeft een reden terug in plaats van alleen `false`, want die reden gaat het
 * beslislog in — anders staat er straks "geen actie" zonder dat iemand kan zien
 * waaróm niet.
 */
export function mayProposeAction(input: {
  type: string;
  channel: ChannelId;
  identification: IdentificationLevel;
}): { ok: true; def: ActionTypeDef } | { ok: false; reason: string } {
  const def = getActionType(input.type);
  if (!def) return { ok: false, reason: `onbekend actietype: ${input.type}` };
  if (!def.channels.includes(input.channel)) {
    return { ok: false, reason: `${def.slug} staat uit op kanaal ${input.channel}` };
  }
  if (!identificationSuffices(input.identification, def.requiredIdentification)) {
    return {
      ok: false,
      reason:
        `${def.slug} vereist identificatie "${def.requiredIdentification}", ` +
        `nu "${input.identification}"`,
    };
  }
  return { ok: true, def };
}

/**
 * Wie mag dit goedkeuren.
 *
 * De grens hoort bij het type en niet bij de gebruiker: een creditnota onder
 * een bedrag mag door een medewerker, erboven niet. Het bedrag komt uit de
 * payload, want dát is wat er daadwerkelijk geboekt wordt — niet een apart
 * veld dat ernaast kan gaan lopen.
 */
export function requiredApproverRole(
  def: ActionTypeDef,
  payload: Record<string, unknown>,
  threshold = def.amountThreshold,
): 'reviewer' | 'admin' {
  if (threshold === undefined) return def.approverRole;
  const bedrag = payload.amount;
  if (typeof bedrag === 'number' && bedrag > threshold) return 'admin';
  return def.approverRole;
}

// ---------------------------------------------------------------------------
// Hervalidatie
// ---------------------------------------------------------------------------

export interface PreconditionDrift {
  field: string;
  was: unknown;
  nu: unknown;
}

/**
 * Vergelijkt de bewaarde preconditie met wat het bronsysteem nu zegt.
 *
 * Dit draait op het moment van goedkeuren, niet bij het voorstellen. De agent
 * stelt om 9:15 een creditnota van 340 euro voor, om 9:40 wordt de order
 * aangepast, om 11:00 drukt iemand op goedkeuren — zonder deze controle boek je
 * 340 euro op een order die niet meer bestaat zoals hij bestond.
 *
 * Alleen velden die in de bewaarde preconditie stáán worden vergeleken. Wat het
 * bronsysteem er verder bij levert is niet waarop dit voorstel is gebaseerd, en
 * meevergelijken zou elk voorstel laten afketsen op ruis.
 */
export function preconditionDrift(
  bewaard: Record<string, unknown>,
  actueel: Record<string, unknown>,
): PreconditionDrift[] {
  const uit: PreconditionDrift[] = [];
  for (const [veld, was] of Object.entries(bewaard)) {
    const nu = actueel[veld];
    if (JSON.stringify(was) !== JSON.stringify(nu)) uit.push({ field: veld, was, nu });
  }
  return uit;
}

/** Is dit voorstel over de datum? */
export function isExpired(action: Pick<ProposedAction, 'expiresAt'>, now: Date): boolean {
  return new Date(action.expiresAt).getTime() <= now.getTime();
}

/**
 * De poort vóór uitvoeren, als één antwoord.
 *
 * Bewust één functie en niet drie losse checks bij de aanroeper: dit is de
 * plek waar een gemiste controle een echte schrijfactie in andermans systeem
 * oplevert, en drie losse checks is drie kansen om er één te vergeten.
 */
export function evaluateApproval(input: {
  action: Pick<ProposedAction, 'status' | 'expiresAt' | 'precondition' | 'type' | 'payload'>;
  actueel: Record<string, unknown>;
  approverRole: 'viewer' | 'reviewer' | 'admin';
  now: Date;
}): { ok: true } | { ok: false; status: 'verlopen' | 'afgewezen'; reason: string } {
  const { action, actueel, approverRole, now } = input;

  if (!canTransitionAction(action.status, 'goedgekeurd')) {
    return {
      ok: false,
      status: 'afgewezen',
      reason: `status ${action.status} kan niet naar goedgekeurd`,
    };
  }

  if (isExpired(action, now)) {
    return { ok: false, status: 'verlopen', reason: 'het voorstel is over de geldigheidsdatum' };
  }

  const def = getActionType(action.type);
  if (!def) {
    return { ok: false, status: 'afgewezen', reason: `onbekend actietype: ${action.type}` };
  }

  const nodig = requiredApproverRole(def, action.payload);
  if (nodig === 'admin' && approverRole !== 'admin') {
    return { ok: false, status: 'afgewezen', reason: 'dit voorstel vraagt om een beheerder' };
  }
  if (approverRole === 'viewer') {
    return { ok: false, status: 'afgewezen', reason: 'alleen lezen' };
  }

  const drift = preconditionDrift(action.precondition, actueel);
  if (drift.length > 0) {
    return {
      ok: false,
      status: 'verlopen',
      reason:
        'de situatie is veranderd sinds het voorstel: ' +
        drift.map((d) => `${d.field} was ${JSON.stringify(d.was)}, nu ${JSON.stringify(d.nu)}`).join('; '),
    };
  }

  return { ok: true };
}
