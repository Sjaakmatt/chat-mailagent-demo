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
}

export const MAIL_CHANNEL: ChannelDef = {
  id: 'mail',
  label: 'E-mail',
  domain: 'mail',
  signalTypes: ['mail.received'],
  reviewItemKind: 'draft_email',
  realtime: false,
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

/** Is dit Signal-type door een geregistreerd kanaal af te handelen? */
export function isSupportedSignalType(type: string): boolean {
  return CHANNELS.some((c) => c.signalTypes.includes(type));
}
