import type { IntentConfig } from './types.js';

/**
 * gdpr — AVG-verzoeken (inzage, correctie, verwijdering, dataportabiliteit).
 *
 * Strict template-antwoord met vaste juridische structuur. Absoluut geen
 * creativiteit — de reviewer moet snel kunnen valideren dat de juiste
 * boilerplate is gebruikt. Automatische acties: ticket aanmaken +
 * audit-log-entry. Nooit persoonsgegevens in de LLM-context dumpen die
 * niet strikt nodig zijn voor de bevestigings-mail.
 *
 * Model-tier: Sonnet (structured output verplicht). needsHitl altijd true
 * — juridische impact.
 */
export const gdprConfig: IntentConfig = {
  id: 'gdpr',
  displayName: 'AVG / privacy-verzoek',
  description:
    'Verzoek onder de AVG: inzage, correctie, verwijdering, ' +
    'dataportabiliteit, bezwaar tegen verwerking. Ook: verzoek tot ' +
    'intrekking van marketing-toestemming.',
  systemPrompt: [
    'Je bevestigt een AVG-verzoek van een klant van {{client}}.',
    'Verplichte structuur van het antwoord:',
    '1. Bevestig dat je het verzoek hebt ontvangen (type: inzage / correctie',
    '   / verwijdering / portabiliteit / bezwaar).',
    '2. Noem de wettelijke reactietermijn (uiterlijk 1 maand, verlenging',
    '   met 2 maanden mogelijk bij complexe verzoeken — art. 12 lid 3 AVG).',
    '3. Bevestig dat het verzoek intern in behandeling wordt genomen door',
    '   een privacy-verantwoordelijke.',
    '4. Vermeld het contactadres van de FG (functionaris gegevensbescherming)',
    '   voor vragen.',
    'Geen inhoudelijke belofte over de uitkomst — dat beslist de privacy-',
    'verantwoordelijke na intern onderzoek. Geen persoonsgegevens die niet',
    'in het verzoek zelf staan.',
    'Toon: neutraal-juridisch, correct Nederlands.',
  ].join('\n'),
  toolScope: [
    // Alleen registratie-tools — GEEN order/product-lookups (privacy-scope).
    // Toekomst: 'tickets.create' om ticket op te voeren, 'audit.log' voor DPA.
  ],
  memoryScope: ['GLOBAL', 'PROCESS'],
  memoryProcessTag: 'gdpr',
  modelTierHint: 'plan',
  // Idem: `needsHitl: true` regelt de strict-review, geen drempel-hack nodig.
  confidenceThreshold: 0.9,
  needsHitl: true,
};
