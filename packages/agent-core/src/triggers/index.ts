/**
 * De triggerlaag — hoe een module aan signalen komt zonder dat er iemand mailt.
 *
 * ## Waarom dit bestaat
 *
 * Tot fase 2 begon alles bij een mail of een chatbericht. Administratie begint
 * bij een openstaande post die te lang openstaat, supply chain bij een
 * voorraadstand, sales bij een offerte zonder reactie. Geen van drieën begint
 * bij een mail. Zonder deze laag zijn die domeinen alleen te bouwen als "iemand
 * mailt erover", en dat is precies het slappe deel van de markt.
 *
 * Vier ingangen, allemaal met dezelfde uitkomst — een `Signal` op de bus:
 *
 * | Ingang | Wie begint | Waar |
 * | --- | --- | --- |
 * | mail/chat | de klant | de bestaande kanalen |
 * | webhook | een extern systeem | `POST /hooks/:bron` |
 * | schedule | de klok | `aios_automations` + dit bestand |
 * | poll | wij, periodiek | `PollDefinition` + `aios_poll_cursors` |
 *
 * Wat hier staat is het rekenwerk: wanneer is iets aan de beurt, en welke
 * tijdsleuf is dat. Puur en testbaar; het emitten zelf staat in de Worker.
 */

import type { DataCategory } from '../access/grants.js';

// ---------------------------------------------------------------------------
// Wat een trigger oplevert
// ---------------------------------------------------------------------------

/**
 * Een signaal-in-wording.
 *
 * Een expander levert dit op; de intake maakt er een `Signal` van. De
 * idempotency-sleutel staat er bewust **niet** op: die stelt de intake samen
 * uit de naam en de tijdsleuf, zodat een expander 'm niet kan vergeten. Wat een
 * expander wél levert is `key` — het stukje dat dít signaal onderscheidt van de
 * andere uit dezelfde tik.
 */
export interface SignalDraft {
  domain: string;
  type: string;
  payload: Record<string, unknown>;
  /**
   * Wat dit signaal onderscheidt binnen één tik, bv. een ticketnummer.
   *
   * Weglaten mag als een tik altijd precies één signaal oplevert. Levert hij er
   * meer en is `key` leeg, dan krijgen ze dezelfde idempotency-sleutel en houdt
   * de bus er één over — dat is stil dataverlies, dus vul 'm in.
   */
  key?: string;
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/**
 * Het rooster van een automatisering, zoals het in `aios_automations.schedule`
 * staat.
 *
 * Drie vormen, bewust geen cron-expressie:
 *
 * | Vorm | Betekenis |
 * | --- | --- |
 * | `hourly` | elk uur, op het hele uur |
 * | `daily@08:30` | elke dag om 08:30 UTC |
 * | `every:15m` | elke 15 minuten (5 t/m 1440) |
 * | `every:6h` | elke 6 uur |
 *
 * Waarom geen cron: een cron-parser is honderden regels voor een
 * uitdrukkingskracht die niemand hier nodig heeft, en `0 8 * * 1-5` is een
 * regel die je verkeerd leest op de dag dat het misgaat. Deze drie vormen
 * dekken wat een klant wil, en wat ze doen staat in de tekst zelf.
 *
 * **Alles in UTC.** Een rooster dat met de zomertijd meebeweegt, draait twee
 * keer of nul keer op de dag dat de klok verspringt.
 */
export type Schedule =
  | { soort: 'hourly' }
  | { soort: 'daily'; uur: number; minuut: number }
  | { soort: 'every'; minuten: number };

/** De ondergrens voor `every:`. Vaker dan dit is geen rooster maar een poller. */
export const MIN_INTERVAL_MINUTEN = 5;

/**
 * Leest een roostertekst. Null als hij niet klopt.
 *
 * Null en geen terugval op "elk uur": een automatisering met een onleesbaar
 * rooster hoort stil te staan met een melding, niet stilzwijgend een ander
 * ritme te krijgen dan er staat.
 */
export function parseSchedule(tekst: string | null | undefined): Schedule | null {
  const s = (tekst ?? '').trim().toLowerCase();
  if (!s) return null;

  if (s === 'hourly') return { soort: 'hourly' };

  const dagelijks = s.match(/^daily@(\d{1,2}):(\d{2})$/);
  if (dagelijks) {
    const uur = Number.parseInt(dagelijks[1]!, 10);
    const minuut = Number.parseInt(dagelijks[2]!, 10);
    if (uur > 23 || minuut > 59) return null;
    return { soort: 'daily', uur, minuut };
  }

  const interval = s.match(/^every:(\d{1,4})(m|h)$/);
  if (interval) {
    const aantal = Number.parseInt(interval[1]!, 10);
    const minuten = interval[2] === 'h' ? aantal * 60 : aantal;
    if (minuten < MIN_INTERVAL_MINUTEN || minuten > 1440) return null;
    return { soort: 'every', minuten };
  }

  return null;
}

/**
 * De tijdsleuf waar dit moment in valt.
 *
 * Dit is de kern van de ontdubbeling. Twee cron-tikken binnen dezelfde sleuf
 * leveren dezelfde string op, dus dezelfde idempotency-sleutel, dus één
 * signaal. Een cron die per ongeluk elke minuut draait, maakt daarmee nog
 * steeds één signaal per uur.
 */
export function slotFor(schedule: Schedule, now: Date): string {
  const iso = now.toISOString();
  switch (schedule.soort) {
    case 'hourly':
      return iso.slice(0, 13); // 2026-08-21T08
    case 'daily':
      return iso.slice(0, 10); // 2026-08-21
    case 'every': {
      // Vensters vanaf middernacht, zodat de sleuf niet verschuift met het
      // moment waarop de Worker toevallig opstartte.
      const minutenVandaag = now.getUTCHours() * 60 + now.getUTCMinutes();
      const venster = Math.floor(minutenVandaag / schedule.minuten) * schedule.minuten;
      return `${iso.slice(0, 10)}T${String(venster).padStart(4, '0')}`;
    }
  }
}

/**
 * Is deze automatisering nu aan de beurt?
 *
 * Twee voorwaarden. De sleuf moet verschillen van die van de vorige run — dat
 * is de ontdubbeling. En bij `daily` moet het tijdstip ook echt geweest zijn:
 * anders zou de eerste tik na middernacht de dagtaak van 08:30 al om 00:05
 * draaien.
 *
 * Nooit gedraaid (`lastRunAt` leeg) telt als "andere sleuf", dus een nieuwe
 * automatisering draait bij de eerstvolgende geldige tik.
 */
export function isDue(
  schedule: Schedule,
  now: Date,
  lastRunAt: string | null | undefined,
): boolean {
  if (schedule.soort === 'daily') {
    const minutenNu = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (minutenNu < schedule.uur * 60 + schedule.minuut) return false;
  }

  const huidig = slotFor(schedule, now);
  if (!lastRunAt) return true;

  const vorig = new Date(lastRunAt);
  if (Number.isNaN(vorig.getTime())) return true;
  return slotFor(schedule, vorig) !== huidig;
}

// ---------------------------------------------------------------------------
// Wat een module aan triggers meebrengt
// ---------------------------------------------------------------------------

/**
 * Wat een expander mag gebruiken om een tik in werk om te zetten.
 *
 * Bewust smal: een organisatie-id, een moment, de config van de rij, en een
 * manier om de klant-database te lezen. **Geen LLM.** Een expander stelt vast
 * wat er is, hij bedenkt niets — dat is precies waarom een opvolgvoorstel geen
 * verzonnen bedragen kan bevatten.
 */
export interface TriggerContext {
  organizationId: string;
  now: Date;
  /** `aios_automations.config`, of leeg. */
  config: Record<string, unknown>;
  /**
   * Leest rijen uit de klant-database.
   *
   * Een functie en geen client, zodat een expander getest kan worden zonder
   * netwerk en niet per ongeluk kan schrijven.
   */
  query<T>(tabel: string, params: Record<string, string>): Promise<T[]>;
}

/**
 * Een geplande automatisering van deze module.
 *
 * `name` moet overeenkomen met `aios_automations.name`: de rij in de database
 * bepaalt óf en wanneer hij draait, de code hier bepaalt wát hij oplevert. Zo
 * kan een beheerder een automatisering aan- en uitzetten zonder deploy, en kan
 * niemand er een taak bij verzinnen zonder code.
 */
export interface ScheduledAutomation {
  name: string;
  /** Eén regel voor de beheerder: wat doet dit, en wanneer heeft het zin. */
  description: string;
  /**
   * Zet één tik om in nul of meer signalen.
   *
   * Nul is een geldige uitkomst en de normale: meestal staat er niets te lang
   * open. Gooien mag, maar kost de hele tik — vang liever af en geef nul terug.
   */
  expand(ctx: TriggerContext): Promise<SignalDraft[]>;
}

/**
 * Een bron die we periodiek zelf bevragen.
 *
 * Voor systemen die geen webhook sturen. De cursor onthoudt waar we gebleven
 * waren; alles daarna is nieuw. Dat is goedkoper en betrouwbaarder dan elke
 * keer alles ophalen en aan onze kant ontdubbelen.
 */
export interface PollDefinition {
  /** Stabiele naam; vormt samen met (org, module) de sleutel van de cursor. */
  source: string;
  /** Eén regel: wat halen we hier op. */
  description: string;
  /** De env-sleutel van de MCP, bv. `FACTUMAI_MCP_ERP_URL`. */
  mcp: string;
  /** De tool op die MCP. */
  tool: string;
  /**
   * Vaste invoer voor de tool. De cursor wordt er als `since` bij gezet.
   */
  input?: Record<string, unknown>;
  /**
   * Datacategorieën die deze poll mag ophalen. Zonder dit krijg je alleen
   * `operationeel` terug en verdwijnen velden stilzwijgend (`docs/RECHTEN.md`).
   */
  dataCategories: readonly DataCategory[];
  /**
   * Het veld waaruit de nieuwe cursor komt, bv. `updatedAt` of `id`.
   *
   * Oplopend en stabiel, anders slaat de poll rijen over. Een tijdstempel met
   * seconde-precisie waarin twee rijen dezelfde waarde kunnen hebben, is
   * daarvoor te grof.
   */
  cursorField: string;
  /** Maakt van één opgehaalde rij een signaal. Puur; geen model. */
  toSignal(rij: Record<string, unknown>): SignalDraft | null;
}

/** Alles wat een module aan eigen ingangen meebrengt. */
export interface ModuleTriggers {
  automations?: readonly ScheduledAutomation[];
  polls?: readonly PollDefinition[];
}

/** De automatisering met deze naam, over de meegegeven modules heen. */
export function automationByName(
  triggers: readonly ModuleTriggers[],
  name: string,
): ScheduledAutomation | null {
  for (const t of triggers) {
    const hit = t.automations?.find((a) => a.name === name);
    if (hit) return hit;
  }
  return null;
}

/**
 * De idempotency-sleutel van een geplande run.
 *
 * De tijdsleuf zit erin, en dat is het hele punt: een dubbele cron-tik binnen
 * dezelfde sleuf levert dezelfde sleutel op, en de bus houdt er één over.
 */
export function scheduleIdempotencyKey(input: {
  name: string;
  slot: string;
  key?: string;
}): string {
  const staart = input.key?.trim() ? `:${input.key.trim()}` : '';
  return `auto:${input.name}:${input.slot}${staart}`;
}

/** Het signaaltype van een geplande automatisering. */
export function scheduleSignalType(name: string): string {
  return `schedule.${name}`;
}

/** Signalen uit een poll dedupliceren op hun cursorwaarde. */
export function pollIdempotencyKey(input: {
  module: string;
  source: string;
  cursor: string;
}): string {
  return `poll:${input.module}:${input.source}:${input.cursor}`;
}

/**
 * De rijen die ná de cursor komen.
 *
 * Vergelijkt als tekst, want dat werkt zowel voor ISO-tijdstempels als voor
 * oplopende id's. Een lege cursor betekent "alles is nieuw" — dat is de eerste
 * run, en dan hoort er inderdaad een inhaalslag te komen.
 *
 * Rijen zonder bruikbare cursorwaarde vallen weg: die zouden de cursor niet
 * vooruit kunnen zetten en dus elke ronde opnieuw langskomen.
 */
export function rowsAfterCursor(
  rijen: readonly Record<string, unknown>[],
  cursorField: string,
  cursor: string | null,
): { rijen: Record<string, unknown>[]; nieuweCursor: string | null } {
  let nieuw = cursor;
  const uit: Record<string, unknown>[] = [];

  for (const rij of rijen) {
    const waarde = rij[cursorField];
    if (typeof waarde !== 'string' || !waarde) continue;
    if (cursor !== null && waarde <= cursor) continue;
    uit.push(rij);
    if (nieuw === null || waarde > nieuw) nieuw = waarde;
  }

  return { rijen: uit, nieuweCursor: nieuw };
}
