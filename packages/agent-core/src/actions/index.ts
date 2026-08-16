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
  /** De tool-call uit dezelfde run die deze waarde dekt. */
  toolCallId: string;
  /** Optioneel: het bronbericht waarin de klant dit vroeg. */
  messageId?: string;
}

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
   * Boven dit bedrag (in euro) is `admin` vereist, ongeacht `approverRole`.
   * Weglaten = geen bedragsgrens. De drempel zelf is een tenant-instelling; dit
   * is de standaard.
   */
  amountThreshold?: number;
  /** Hoe lang een voorstel geldig blijft. Daarna: verlopen. */
  expiresAfterMinutes: number;
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
  },
  {
    slug: 'adres_wijzigen',
    label: 'Verzendadres wijzigen',
    target: { mcp: 'erp', tool: 'update_order_address' },
    preconditionKind: 'orderstatus',
    // De grootste fraudewaarde van de hele set: een pakket omleiden is schade,
    // geen ongemak. Daarom mail-only, en bij mail nog steeds gematcht.
    channels: ['mail'],
    requiredIdentification: 'gematcht',
    approverRole: 'reviewer',
    expiresAfterMinutes: 12 * 60,
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
  },
  {
    slug: 'creditnota_voorstellen',
    label: 'Creditnota voorstellen',
    target: { mcp: 'crm', tool: 'create_credit_note' },
    preconditionKind: 'factuurstatus',
    channels: ['mail'],
    requiredIdentification: 'gematcht',
    approverRole: 'reviewer',
    // Geld. Boven dit bedrag moet een admin het doen.
    amountThreshold: 250,
    expiresAfterMinutes: 24 * 60,
  },
]);

export const ACTION_TYPE_SLUGS: readonly string[] = Object.freeze(
  ACTION_TYPES.map((t) => t.slug),
);

export function getActionType(slug: string): ActionTypeDef | undefined {
  return ACTION_TYPES.find((t) => t.slug === slug);
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
