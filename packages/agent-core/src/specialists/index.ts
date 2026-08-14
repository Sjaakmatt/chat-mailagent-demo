/**
 * Intent-registry barrel — de centrale plek waar de plan-stap opzoekt "welke
 * config hoort bij deze specialist?".
 *
 * Kern-specialisten zijn code (importeerbaar/typebaar/testbaar). Nieuwe
 * experimentele specialisten kunnen later via een data-driven laag toegevoegd
 * worden zonder deploy (zie discovery-flow in migratie 0018 / Fase B); die
 * worden dan opgezocht via een dynamische registry-provider die uit de
 * database leest, niet uit dit bestand.
 */

import type { SpecialistId } from '../contracts/index.js';
import type { IntentConfig } from './types.js';
import { simpleReplyConfig } from './simple-reply.js';
import { orderChangeConfig } from './order-change.js';
import { complaintConfig } from './complaint.js';
import { technicalConfig } from './technical.js';
import { gdprConfig } from './gdpr.js';
import { escalateConfig } from './escalate.js';

export * from './types.js';

/**
 * De 5 kern-specialisten + escalate-fallback. Volgorde is de default-
 * volgorde waarin de router ze in z'n prompt-lijst opsomt.
 *
 * Klant-specifieke intents horen hier niet: die voeg je toe in de klant-repo
 * (extra config-bestand + registratie hieronder), of data-driven via de
 * experimentele-specialisten-tabel. Zie `examples/warehouse-module/specialists/`
 * voor een werkend voorbeeld.
 */
export const CORE_INTENTS: readonly IntentConfig[] = Object.freeze([
  simpleReplyConfig,
  orderChangeConfig,
  complaintConfig,
  technicalConfig,
  gdprConfig,
  escalateConfig,
]);

/**
 * Lookup-map voor snelle O(1) resolutie op basis van SpecialistId.
 * `escalate` is de veilige fallback: als een router een onbekende
 * specialist teruggeeft, gebruikt de orchestrator deze config.
 */
export const INTENT_REGISTRY: ReadonlyMap<SpecialistId, IntentConfig> = new Map(
  CORE_INTENTS.map((c) => [c.id, c]),
);

/**
 * Resolvet een `SpecialistId` naar de bijbehorende `IntentConfig`. Onbekende
 * IDs → `escalate` (nooit throwen — de agent moet blijven werken, de mail
 * gaat gewoon naar de menselijke queue).
 */
export function getIntentConfig(id: SpecialistId): IntentConfig {
  return INTENT_REGISTRY.get(id) ?? escalateConfig;
}

/** Lijst van bekende specialist-IDs; handig voor router-prompt-samenstelling. */
export function knownSpecialistIds(): SpecialistId[] {
  return CORE_INTENTS.map((c) => c.id);
}

export {
  simpleReplyConfig,
  orderChangeConfig,
  complaintConfig,
  technicalConfig,
  gdprConfig,
  escalateConfig,
};
