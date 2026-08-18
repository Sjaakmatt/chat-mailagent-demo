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

/**
 * Eén afgeronde beurt uit hetzelfde gesprek.
 *
 * Bestaat zodat "en die klant?" te begrijpen is zonder dat de medewerker zijn
 * vorige vraag herhaalt. Het is nadrukkelijk **geen bron**: wat er in een
 * eerdere beurt stond, is in díé beurt gecontroleerd en telt nu niet mee als
 * dekking. Zou het dat wel doen, dan kon een bewering via het gesprek naar
 * binnen lopen en daarna zichzelf dekken.
 */
export interface AssistantTurn {
  question: string;
  answer: string;
}

export interface AssistantPromptInput {
  /** De vraag van de medewerker. */
  question: string;
  /**
   * Waar hij naar kijkt, in één regel: "concept-antwoord op klantmail X", of
   * — als er niets openstaat — welk proces het gesprek gaat.
   */
  contextLabel: string;
  sources: readonly AssistantSource[];
  /** Naam van de organisatie, voor de toon. */
  clientName: string;
  /** Eerdere beurten uit hetzelfde gesprek, oudste eerst. */
  history?: readonly AssistantTurn[];
}

const SYSTEM = `Je bent de werkbak-assistent van {{client}}. Je helpt een medewerker die een
voorstel van de agent beoordeelt.

WAT JE DOET
- Vragen beantwoorden over het werk in de werkbak: het beleid, de werkvoorraad,
  klanten en eerder afgehandelde zaken, op basis van de bronnen hieronder.
- Staat er een voorstel open, dan gaan vragen daar meestal over: wat stelt de
  agent voor, waarom, en wat is de geschiedenis van deze klant.
- Uitleggen waarom de agent iets voorstelt, op basis van het beslislog.

HET GESPREK
Eerdere beurten staan erbij zodat je een vervolgvraag begrijpt — "en die
klant?" slaat terug op waar het net over ging. Ze zijn géén bron: wat je eerder
zei mag je niet citeren en niet als vaststaand aannemen. Elke bewering in dit
antwoord komt uit de bronnenlijst hieronder, ook als je hem eerder al deed.

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
  const history = input.history ?? [];

  // Het gesprek gaat als tekst mee in dezelfde beurt, niet als losse
  // model-beurten. Reden: de bronnenlijst moet ná de geschiedenis staan en
  // vlak vóór de vraag, zodat "de bronnen hieronder" uit de systeemprompt ook
  // letterlijk klopt. Als losse beurten zou de dekking van beurt drie tussen
  // twee oude antwoorden in staan.
  const gesprek =
    history.length > 0
      ? [
          'EERDERE BEURTEN (context, geen bron):',
          ...history.map(
            (t) => `- medewerker: ${t.question}\n  assistent: ${t.answer}`,
          ),
          '',
        ]
      : [];

  const user = [
    `CONTEXT: ${input.contextLabel}`,
    '',
    ...gesprek,
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
 * Hoeveel beurten er meegaan. Zes is drie vraag-en-antwoord-paren: genoeg om
 * een vervolgvraag te begrijpen, kort genoeg dat de bronnen van déze beurt niet
 * ondersneeuwen in oude tekst.
 */
export const MAX_HISTORY_TURNS = 6;

/** Hoeveel tekst er per eerder antwoord meegaat. */
const MAX_HISTORY_ANSWER_CHARS = 600;

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

/**
 * Schoont de meegestuurde gespreksgeschiedenis op.
 *
 * Die komt uit de browser en is dus niet te vertrouwen: een beurt kan verzonnen
 * zijn. Dat is hier minder erg dan het klinkt, want geschiedenis dekt niets —
 * de controle in `answer.ts` kijkt uitsluitend naar de bronnen van deze beurt.
 * Wat wél moet gebeuren is begrenzen, zodat niemand via het gesprek een prompt
 * van willekeurige lengte naar binnen schuift.
 *
 * Alleen de laatste beurten, en alleen paren die aan twee kanten inhoud hebben.
 */
export function normalizeHistory(raw: unknown): AssistantTurn[] {
  if (!Array.isArray(raw)) return [];
  const uit: AssistantTurn[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const t = item as { question?: unknown; answer?: unknown };
    if (typeof t.question !== 'string' || typeof t.answer !== 'string') continue;
    const question = t.question.trim().slice(0, MAX_QUESTION_CHARS);
    const answer = t.answer.trim().slice(0, MAX_HISTORY_ANSWER_CHARS);
    if (!question || !answer) continue;
    uit.push({ question, answer });
  }
  return uit.slice(-MAX_HISTORY_TURNS);
}
