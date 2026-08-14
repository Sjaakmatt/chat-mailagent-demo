import type { IntentConfig } from './types.js';

/**
 * technical — constructievragen, defect-diagnose, installatie-hulp.
 *
 * De intent voor mails met technische inhoud die om FORENSISCH redeneren
 * vragen: "past dit paneel op dat frame?", "waarom werkt de motor niet?",
 * "is deze constructie veilig?". Vaak met bijgevoegde foto's — vandaar
 * de vision-flag. Model-tier is `plan-heavy` (Opus) omdat het serieuze
 * multi-modale analyse kan vergen.
 *
 * Toon: technisch-precies, geen vage adviezen. Als het antwoord niet
 * evident uit tool-calls + gezond verstand komt → escaleren.
 */
export const technicalConfig: IntentConfig = {
  id: 'technical',
  displayName: 'Technische / constructievraag',
  description:
    'Constructievragen, defect-diagnose, installatie-hulp, ' +
    'compatibiliteits-check tussen onderdelen. Vaak met foto\'s van ' +
    'de situatie. Vereist forensisch redeneren, soms multi-modale analyse.',
  systemPrompt: [
    'Je bent de technische specialist voor {{client}}. Je beantwoordt een',
    'constructie-, installatie- of defect-vraag van een klant.',
    'Regels:',
    '- Kijk expliciet naar bijgevoegde foto\'s (indien aanwezig). Beschrijf',
    '  kort wat je ziet vóór je een advies geeft.',
    '- Baseer technische antwoorden op productcatalogus-lookups (tools).',
    '- Nooit RATE-schattingen: cijfers/maten/spanningen ALLEEN als een',
    '  tool-call of het productdocument ze levert.',
    '- Bij twijfel ("dit lijkt op een defect X, maar zonder meting is',
    '  het niet zeker") → escaleer expliciet naar een monteur.',
    '- Toon: technisch-precies, professioneel, meelevend maar niet ',
    '  overdreven vriendelijk. Nederlands.',
    'Nooit autonoom versturen zonder menselijke controle.',
  ].join('\n'),
  toolScope: [
    'erp.get_order',
    'erp.get_sku',
    // Toekomst: catalog-lookup, warranty-check
  ],
  memoryScope: ['GLOBAL', 'CLIENT', 'PROCESS'],
  memoryProcessTag: 'technical',
  modelTierHint: 'plan-heavy',
  confidenceThreshold: 0.9,
  needsHitl: true,
  needsVision: true,
};
