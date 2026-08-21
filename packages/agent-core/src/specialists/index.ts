/**
 * Het specialisten-contract — wat een specialist is, niet wíe de specialisten
 * zijn.
 *
 * Kern-specialisten zijn code (importeerbaar/typebaar/testbaar). Ze horen bij
 * een **module**: `modules/klantenservice/specialists/` bevat de zes van de
 * mailagent, en administratie brengt straks zijn eigen zes mee. Tot fase 1
 * stond hier één bevroren `CORE_INTENTS`, en dat was precies de aanname die een
 * tweede domein onmogelijk maakte.
 *
 * Wat hier overblijft: het type, en de lookups die de lus nodig heeft. Die
 * nemen de lijst als parameter — de kern kiest niet wélke specialisten er zijn,
 * hij zoekt er eentje in de lijst die het pakket meelevert.
 *
 * Experimentele specialisten kunnen later data-driven worden toegevoegd zonder
 * deploy (zie discovery-flow in migratie 0018); die komen dan uit een
 * registry-provider die uit de database leest, en gaan door dezelfde lookups.
 */

import type { SpecialistId } from '../contracts/index.js';
import type { IntentConfig } from './types.js';

export * from './types.js';

/**
 * Zoekt de config bij een `SpecialistId` binnen één module.
 *
 * Gooit nooit. Een onbekend id valt terug op de laatste specialist in de lijst,
 * en dat is per afspraak de escalatie-variant: bij twijfel een mens, niet een
 * willekeurige andere specialist. Een lege lijst geeft `undefined` — dan is er
 * geen pakket geladen en hoort de aanroeper dat te merken, niet te maskeren.
 */
export function getIntentConfig(
  specialists: readonly IntentConfig[],
  id: SpecialistId,
): IntentConfig | undefined {
  return (
    specialists.find((c) => c.id === id) ?? specialists[specialists.length - 1]
  );
}

/** De bekende specialist-ids van deze module; voedt de router-prompt. */
export function knownSpecialistIds(
  specialists: readonly IntentConfig[],
): SpecialistId[] {
  return specialists.map((c) => c.id);
}

/** Is dit een specialist die deze module kent? */
export function isKnownSpecialist(
  specialists: readonly IntentConfig[],
  id: string,
): id is SpecialistId {
  return specialists.some((c) => c.id === id);
}
