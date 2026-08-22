import type { IntentConfig } from '../../../specialists/index.js';

/**
 * simple_reply — de "korte-vraag / status-check"-specialist.
 *
 * Voor mails die een enkelvoudige, feitelijke vraag stellen: order-status,
 * tracking, openingstijden, generieke FAQ. Doel: **kort en feitelijk**
 * antwoord op basis van tool-calls. Geen redenering, geen creativiteit,
 * geen advies. Als er twijfel is of het écht simpel is → confidence
 * daalt en de ReviewItem gaat toch de menselijke queue in.
 *
 * Model-tier: Haiku (goedkoop, snel) — deze mails hebben geen
 * planningswerk nodig.
 */
export const simpleReplyConfig: IntentConfig = {
  id: 'simple_reply',
  displayName: 'Korte statusvraag',
  description:
    'Enkelvoudige feitelijke vraag: order-status, tracking, levertijd, ' +
    'openingstijden, generieke FAQ. Geen wijziging, geen klacht.',
  systemPrompt: [
    'Je beantwoordt een korte, feitelijke vraag van een klant van {{client}}.',
    'Regels:',
    '- Antwoord kort (max 3 zinnen), zakelijk-vriendelijk, in het Nederlands.',
    '- Alleen feiten die je uit tool-calls hebt gehaald mogen als concrete',
    '  informatie in het antwoord. Geen inschattingen, geen "waarschijnlijk".',
    '- Als de tool-call geen antwoord gaf, zeg je eerlijk dat je het opzoekt',
    '  en dat een collega contact opneemt.',
    '- Sluit af met een neutrale groetregel (geen overdreven vriendelijkheid).',
  ].join('\n'),
  // De namen komen uit `facts.ts` van deze module. Wat hier niet staat, wordt
  // voor deze specialist niet opgehaald — geen filter achteraf, de call
  // gebeurt niet. De factuur staat er bewust niet bij: een statusvraag
  // beantwoorden vraagt niet om bedragen.
  toolScope: [
    'catalog.list',
    'order.get',
    'order.tracking',
  ],
  memoryScope: ['GLOBAL', 'CLIENT'],
  memoryProcessTag: undefined,
  modelTierHint: 'classify',
  confidenceThreshold: 0.75,
  needsHitl: false,
};
