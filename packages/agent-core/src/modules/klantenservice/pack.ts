/**
 * Het modulepakket van klantenservice.
 *
 * Dit is wat de lus uitleest zodra een signaal aan deze module wordt
 * toegewezen: welke poort, welke categorieën, welke specialisten, welke
 * schrijfoperaties, wanneer iets automatisch mag. De kern kent dit bestand niet
 * bij naam — de registry noemt hem, en die wordt gegenereerd uit
 * `client.manifest.yaml`.
 *
 * De stukken staan bewust in aparte bestanden en niet hier: de taxonomie en de
 * poort zijn wat je per klant aanpast, en die wil je kunnen openen zonder door
 * zes prompts te scrollen.
 */

import type { ModulePack } from '../contract.js';
import { KLANTENSERVICE_MODULE } from './descriptor.js';
import { KLANTENSERVICE_GATE } from './gate.js';
import { KLANTENSERVICE_TAXONOMY } from './taxonomy.js';
import { KLANTENSERVICE_SPECIALISTS } from './specialists/index.js';
import { KLANTENSERVICE_ACTIONS } from './actions.js';
import { KLANTENSERVICE_OUTCOMES } from './outcomes.js';

export const klantenservicePack: ModulePack = {
  descriptor: KLANTENSERVICE_MODULE,

  // Alles wat via mail of chat binnenkomt. Komt administratie erbij, dan claimt
  // die een eigen domein (bank, erp) of scherpt deze claim aan met een
  // predicaat — twee modules die hetzelfde signaal claimen is een fout die de
  // registry meldt, geen stille wedstrijd.
  claims: [
    { domain: 'mail', type: 'mail.received' },
    { domain: 'chat', type: 'chat.message' },
  ],

  gate: KLANTENSERVICE_GATE,
  taxonomy: KLANTENSERVICE_TAXONOMY,
  specialists: KLANTENSERVICE_SPECIALISTS,

  // Fase 3 vult dit. Vandaag komen de feiten uit vaste lookups in de
  // agent-Worker; zodra ze hiervandaan komen, wordt `toolScope` op de
  // specialisten ook echt gehandhaafd.
  facts: [],

  actions: KLANTENSERVICE_ACTIONS,
  outcomes: KLANTENSERVICE_OUTCOMES,

  review: {
    // Een concept-mail. De chat-variant (`draft_reply`) wordt expliciet gezet
    // door het kanaal, niet hier.
    defaultKind: 'draft_email',
  },

  memory: {
    // De procestags die dit domein gebruikt in `aios_memory_entries`. Lopen
    // gelijk met de specialisten die een `memoryProcessTag` zetten.
    processTags: ['order_change', 'complaint', 'technical', 'gdpr'],
  },
};

export { KLANTENSERVICE_MODULE };
