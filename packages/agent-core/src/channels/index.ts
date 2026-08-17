/**
 * Kanaal-registry — de naad waarlangs de agent later méér dan mail aankan.
 *
 * De lus zelf (classify → resolve → retrieve → plan → ground → ReviewItem →
 * mens keurt goed → execute) is kanaal-onafhankelijk: de specialisten schrijven
 * een antwoordtekst, niet een e-mail. Alleen aan de randen zit kanaal-kennis:
 *
 *   in    — welk Signal-`domain`/`type` hoort bij dit kanaal
 *   uit   — welke `ReviewItemKind` de orchestrator produceert, en welke
 *           bezorgroutine de Execute-Workflow moet aanroepen
 *
 * Vandaag is `mail` het enige geregistreerde kanaal. Een chat-kanaal
 * toevoegen betekent: hier een `ChannelDef` bijzetten, in de agent-Worker een
 * bezorgroutine registreren (`channels.ts` → `DELIVERY`), en de cockpit een
 * weergave voor die `kind` geven. De kern-lus blijft ongemoeid.
 */

import type { ReviewItemKind } from '../contracts/index.js';

/** Bekende kanalen. Open union: een klant mag een eigen kanaal toevoegen. */
export type ChannelId = 'mail' | 'chat' | (string & {});

export interface ChannelDef {
  id: ChannelId;
  /** Label voor cockpit en audit. */
  label: string;
  /** Signal-`domain` waarop dit kanaal binnenkomt. */
  domain: string;
  /** Signal-`type`s die dit kanaal aanneemt (bv. 'mail.received'). */
  signalTypes: string[];
  /** De soort ReviewItem die de orchestrator voor dit kanaal produceert. */
  reviewItemKind: ReviewItemKind;
  /**
   * Verwacht een antwoord binnen enkele seconden (chat/telefonie) in plaats van
   * minuten (mail). Bepaalt of de mens-in-de-lus praktisch haalbaar is: bij
   * `true` hoort een strakkere autonomie-afweging en een kortere poll-cadans.
   */
  realtime: boolean;
  /**
   * Wacht een item van dit kanaal in de werkbak op een mens?
   *
   * Bewust een eigen veld en niet `!realtime`. Dat zijn twee verschillende
   * uitspraken die vandaag toevallig samenvallen: `realtime` zegt hoe snel er
   * een antwoord moet komen, dit zegt wie er beslist. Een kanaal kan snel zijn
   * én toch review nodig hebben — telefonie waar een medewerker meeluistert,
   * bijvoorbeeld. Ze samenvoegen zou dat onderscheid ongemerkt weggooien.
   *
   * Bij `false` produceert de lus nog steeds een ReviewItem — dat is de
   * verankering waar het beslislog en (bij uitkomst `taak`) het ticket aan
   * hangen — maar de werkbak toont het niet. Het gesprek staat al onder
   * Gesprekken en het werk onder Tickets; het item er als derde kopie bij zetten
   * maakt van de wachtrij een plek waar drie dingen door elkaar lopen.
   */
  queuesForReview: boolean;
}

export const MAIL_CHANNEL: ChannelDef = {
  id: 'mail',
  label: 'E-mail',
  domain: 'mail',
  signalTypes: ['mail.received'],
  reviewItemKind: 'draft_email',
  realtime: false,
  // Mail is de werkbak zoals hij bedoeld is: een concept dat wacht tot een mens
  // het goedkeurt. Harde regel 1.
  queuesForReview: true,
};

/**
 * Chat. Realtime: er zit iemand te wachten, dus een concept in een wachtrij
 * werkt hier niet. De beleidslaag en de domeingrens zijn wat tussen de agent
 * en de bezoeker staat — bij mail is dat een mens.
 *
 * Welke uitkomsten zonder mens naar buiten mogen, staat in
 * `outcomes/mayRespondWithoutHuman()`: `kennis` en `systeem` wel, `taak` en
 * `onbekend` niet.
 */
export const CHAT_CHANNEL: ChannelDef = {
  id: 'chat',
  label: 'Chat',
  domain: 'chat',
  signalTypes: ['chat.message'],
  reviewItemKind: 'draft_chat_reply',
  realtime: true,
  // Niet in de werkbak. Tegen de tijd dat een medewerker het item zou zien, is
  // het antwoord al bij de bezoeker — er valt niets meer goed te keuren. Wat er
  // wél te doen valt, staat waar het thuishoort: het gesprek onder Gesprekken,
  // en bij uitkomst `taak` het uitzoekwerk onder Tickets.
  queuesForReview: false,
};

/**
 * Actieve kanalen voor deze klant. Haal weg wat een klant niet afneemt: een
 * geregistreerd kanaal zonder bezorgroutine faalt luid bij het uitvoeren, en
 * dat is beter dan stilletjes niets doen.
 */
export const CHANNELS: readonly ChannelDef[] = Object.freeze([MAIL_CHANNEL, CHAT_CHANNEL]);

const BY_KIND = new Map<string, ChannelDef>(
  CHANNELS.map((c) => [c.reviewItemKind, c]),
);

const BY_DOMAIN = new Map<string, ChannelDef>(CHANNELS.map((c) => [c.domain, c]));

/** Welk kanaal hoort bij deze ReviewItem-soort? */
export function channelForKind(kind: string): ChannelDef | undefined {
  return BY_KIND.get(kind);
}

/** Welk kanaal hoort bij dit Signal-domein? */
export function channelForDomain(domain: string): ChannelDef | undefined {
  return BY_DOMAIN.get(domain);
}

/**
 * De ReviewItem-soorten die **niet** in de werkbak horen.
 *
 * Een uitsluitlijst en geen toelatingslijst, en dat is het hele punt: een module
 * die z'n eigen soort produceert (een magazijnbon, een factuurvoorstel) hoort
 * gewoon in de werkbak zonder zich ergens te melden. Alleen een kanaal dat zijn
 * werk elders afhandelt, haalt zichzelf hier weg. Andersom zou elke nieuwe
 * automatisering onzichtbaar beginnen tot iemand ontdekt dat er een lijst is.
 */
export function kindsHandledOutsideWorkbench(): string[] {
  return CHANNELS.filter((c) => !c.queuesForReview).map((c) => c.reviewItemKind);
}

/** Is dit Signal-type door een geregistreerd kanaal af te handelen? */
export function isSupportedSignalType(type: string): boolean {
  return CHANNELS.some((c) => c.signalTypes.includes(type));
}
