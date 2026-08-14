import type { IntentConfig } from './types.js';

/**
 * escalate — fallback voor mails die de router niet met voldoende
 * confidence op een bestaande specialist kon plaatsen, of expliciet
 * naar een mens moeten (uit de router-flags: juridisch, urgent-zonder-
 * context, onbekende taal).
 *
 * Geen tools, geen memory-retrieval, geen plan-LLM: de mail gaat regelrecht
 * de menselijke queue in met een korte machine-gegenereerde samenvatting.
 * De router-reasoning wordt ook in `aios_unknown_intent_log` gelogd voor
 * latere auto-discovery-analyse (zie migratie 0018).
 */
export const escalateConfig: IntentConfig = {
  id: 'escalate',
  displayName: 'Escalatie naar mens',
  description:
    'Router kon deze mail niet met voldoende zekerheid op een bestaande ' +
    'specialist plaatsen, of er is een expliciete escalatie-trigger ' +
    '(juridische taal zonder klacht-context, onbekend onderwerp).',
  systemPrompt: [
    'Deze mail wordt niet automatisch beantwoord. Genereer alleen een',
    'korte NL-samenvatting (max 2 zinnen) van waar de mail over gaat,',
    'zodat de reviewer snel kan triageren.',
    'Geen advies, geen antwoord-tekst, geen aannames.',
  ].join('\n'),
  toolScope: [],
  memoryScope: [],
  modelTierHint: 'classify',
  confidenceThreshold: 0,
  needsHitl: true,
};
