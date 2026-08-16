/**
 * De prompt van de assistent.
 *
 * Twee dingen staan er hard in en die zijn niet cosmetisch:
 *
 *   1. **Citeren is verplicht.** Elke feitelijke bewering krijgt een bron-id.
 *      Zonder dat kan de controle in `answer.ts` niets, en dan is de hele
 *      grounding-belofte een intentie in plaats van een mechanisme.
 *   2. **Niet kunnen antwoorden is een goede uitkomst.** Het model krijgt een
 *      expliciet veld om te zeggen dat het er niet staat. Modellen die dat veld
 *      niet hebben, vullen de leegte — en dat is precies wat we niet willen.
 *
 * De assistent voert niets uit. Dat staat er ook in, maar het is geen prompt-
 * garantie: hij *kan* het niet, want er zit geen schrijfroute in de laag
 * eromheen. De promptregel is er om te voorkomen dat hij het aanbiedt.
 */

import type { LlmMessage } from '../llm/index.js';
import { renderSources, type AssistantSource } from './sources.js';

export interface AssistantPromptInput {
  /** De vraag van de medewerker. */
  question: string;
  /** Waar hij naar kijkt, in één regel: "concept-antwoord op klantmail X". */
  contextLabel: string;
  sources: readonly AssistantSource[];
  /** Naam van de organisatie, voor de toon. */
  clientName: string;
}

const SYSTEM = `Je bent de werkbak-assistent van {{client}}. Je helpt een medewerker die een
voorstel van de agent beoordeelt.

WAT JE DOET
- Vragen beantwoorden over het openstaande voorstel, de klant, het beleid en
  eerder afgehandelde zaken, op basis van de bronnen hieronder.
- Uitleggen waarom de agent iets voorstelt, op basis van het beslislog.

WAT JE NOOIT DOET
- Een handeling uitvoeren of een antwoord versturen. Je bent een
  raadpleegvenster; alles wat naar buiten gaat, gaat via de knoppen in de
  werkbak. Bied het ook niet aan.
- Iets beweren dat niet in de bronnen staat. Geen schattingen, geen
  "waarschijnlijk", geen algemene kennis over hoe het meestal gaat.
- Een getal noemen dat niet letterlijk in een bron staat. Ook niet als je het
  zelf kunt uitrekenen: rekenen doe je niet.

CITEREN
Elke feitelijke bewering krijgt de id van de bron die hem dekt. Een bewering
zonder bron hoort niet in je antwoord.

ALS HET ER NIET STAAT
Zeg dat. Vul het veld "cannotAnswer" met één zin over wat je mist. Dat is een
goed antwoord — beter dan een gok die geloofd wordt.

ANTWOORDVORM
Uitsluitend JSON, geen tekst eromheen:
{
  "answer": "je antwoord in het Nederlands, kort en concreet",
  "claims": [{ "statement": "de bewering zoals hij in je antwoord staat", "sourceId": "de bron-id" }],
  "cannotAnswer": null
}
Bij een vraag die je niet kunt beantwoorden: "answer" leeg laten en
"cannotAnswer" vullen.`;

export function buildAssistantPrompt(input: AssistantPromptInput): LlmMessage[] {
  const system = SYSTEM.replace('{{client}}', input.clientName);
  const user = [
    `CONTEXT: ${input.contextLabel}`,
    '',
    'BRONNEN:',
    renderSources(input.sources),
    '',
    `VRAAG VAN DE MEDEWERKER: ${input.question}`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Maximale lengte van een vraag. Langer is bijna altijd geplakte troep. */
export const MAX_QUESTION_CHARS = 1000;

/**
 * Schoont de vraag op. Null als er niets bruikbaars overblijft — dan hoeft er
 * geen model aan te pas te komen.
 */
export function normalizeQuestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_QUESTION_CHARS);
}
