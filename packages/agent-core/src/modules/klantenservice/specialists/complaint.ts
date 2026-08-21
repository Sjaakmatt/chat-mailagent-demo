import type { IntentConfig } from '../../../specialists/index.js';

/**
 * complaint — klachtenafhandeling, inclusief juridisch-gevoelige mails.
 *
 * Vereist een EMPATHISCHE toon zonder aansprakelijkheid toe te geven, en
 * de-escalatie waar mogelijk. Nooit autonoom versturen — dit domein raakt
 * reputatie en juridische exposure. Tools zijn read-only: klachten mogen
 * geen automatische backend-mutaties triggeren (geen creditnota's, geen
 * status-wijzigingen zonder mens). Precedence-regel: als tijdens compound-
 * mails deze intent voorkomt, wint z'n toon over neutrale intents.
 *
 * Model-tier: Sonnet. AVG-gevoelige data (klantnaam, situatie) blijft in
 * de LLM-context, niet in tool-calls.
 */
export const complaintConfig: IntentConfig = {
  id: 'complaint',
  displayName: 'Klacht',
  description:
    'Klant uit een klacht, ontevredenheid, of juridisch-toonzettende ' +
    'kritiek. Vaak in combinatie met eerdere feiten (defect, te late ' +
    'levering, verkeerde levering).',
  systemPrompt: [
    'Je stelt een concept-antwoord op voor een klacht van een klant van {{client}}.',
    'Toon: empathisch, meelevend, professioneel-neutraal. Nederlands.',
    'Regels:',
    '- ERKEN de emotie/frustratie kort, zonder overdreven excuses.',
    '- GEEF NIETS TOE dat op aansprakelijkheid lijkt (geen "u heeft gelijk",',
    '  geen "wij hebben gefaald", geen bedragen/vergoedingen).',
    '- Beschrijf de vervolgstap: "een collega neemt binnen X werkdagen',
    '  contact met u op" of "wij gaan het intern uitzoeken".',
    '- Geen automatische compensatie, geen creditnota, geen onmiddellijke',
    '  belofte. Alleen menselijke opvolging.',
    '- Als het een juridische toon heeft ("aansprakelijk", "advocaat",',
    '  "consumentenprogramma") → escalatie-flag opnemen in de review.',
    'Deze mail wordt NOOIT autonoom verstuurd — de reviewer beslist.',
  ].join('\n'),
  toolScope: [
    'erp.get_order',
    'bc.get_order',
  ],
  memoryScope: ['GLOBAL', 'CLIENT', 'PROCESS'],
  memoryProcessTag: 'complaint',
  modelTierHint: 'plan',
  // Confidence-drempel is voor klachten niet leidend — `needsHitl: true`
  // dwingt altijd al review af (zie deriveTriage).
  confidenceThreshold: 0.9,
  needsHitl: true,
};
