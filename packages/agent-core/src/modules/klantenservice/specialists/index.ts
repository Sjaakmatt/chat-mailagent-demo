/**
 * De specialisten van klantenservice — wie schrijft welke tekst.
 *
 * Stond tot fase 1 in `specialists/index.ts` als één bevroren `CORE_INTENTS`.
 * Dat was de aanname dat er maar één domein bestaat: administratie heeft geen
 * `complaint`-specialist, en klantenservice geen `crediteur`-specialist.
 *
 * De volgorde is de volgorde waarin de router ze in zijn prompt opsomt.
 * `escalate` staat achteraan en is ook de veilige terugval bij een onbekend id.
 *
 * Een extra specialist voor deze klant: een bestand erbij en een regel hier.
 * Hoort hij bij een ánder proces, dan hoort hij in dat pakket en niet hier.
 */

import type { IntentConfig } from '../../../specialists/index.js';
import { simpleReplyConfig } from './simple-reply.js';
import { orderChangeConfig } from './order-change.js';
import { complaintConfig } from './complaint.js';
import { technicalConfig } from './technical.js';
import { gdprConfig } from './gdpr.js';
import { escalateConfig } from './escalate.js';

export const KLANTENSERVICE_SPECIALISTS: readonly IntentConfig[] = Object.freeze([
  simpleReplyConfig,
  orderChangeConfig,
  complaintConfig,
  technicalConfig,
  gdprConfig,
  escalateConfig,
]);

export {
  simpleReplyConfig,
  orderChangeConfig,
  complaintConfig,
  technicalConfig,
  gdprConfig,
  escalateConfig,
};
