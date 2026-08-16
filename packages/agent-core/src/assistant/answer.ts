/**
 * Het antwoord van de assistent, en de controle die het moet doorstaan.
 *
 * De regel: **elke bewering herleidbaar naar een bron uit dezelfde vraag.** Dat
 * is de bestaande numerical-grounding-regel, toegepast op een antwoord aan een
 * medewerker in plaats van aan een klant. Hier is hij zo mogelijk belangrijker:
 * een klant leest een concept dat een mens nog nakijkt, maar een medewerker die
 * de assistent iets vraagt, handelt ernaar.
 *
 * Twee controles, met een verschillende betekenis:
 *
 *   verzonnen bron  — een citaat wijst naar een id die niet bestaat. Het model
 *                     heeft een bron gefabriceerd om een bewering te dekken.
 *   ongedekt getal  — een getal in het antwoord komt in géén enkele
 *                     aangeleverde bron voor. De assistent had alleen die
 *                     bronnen, dus hij kan het nergens anders vandaan hebben.
 *
 * Beide zijn waar-per-constructie: er is geen legitieme manier waarop ze
 * afgaan op een correct antwoord. Daarom is de uitkomst hard — een antwoord dat
 * zakt, gaat niet met een waarschuwingsrandje naar de gebruiker maar wordt
 * ingehouden. Een assistent die plausibel klinkt en het verzint is erger dan
 * geen assistent, want hij wordt geloofd.
 */

import { extractNumericTokens } from '../grounding/index.js';
import type { AssistantSource } from './sources.js';

/** Eén bewering met de bron die hem dekt. */
export interface AssistantClaim {
  /** De bewering, zoals hij in het antwoord staat. */
  statement: string;
  /** De id van de bron die hem dekt. */
  sourceId: string;
}

/** De ruwe, nog niet gevalideerde output van het model. */
export interface ParsedAssistantAnswer {
  answer: string;
  claims: AssistantClaim[];
  /**
   * Het model geeft zelf aan dat het de vraag niet kan beantwoorden met wat het
   * heeft. Dat is een goede uitkomst, geen fout: liever "dat staat hier niet"
   * dan een gok.
   */
  cannotAnswer?: string | null;
}

/** Waarom een antwoord is ingehouden. */
export type RefusalReason =
  /** Het model gaf zelf aan het niet te kunnen beantwoorden. */
  | 'geen_bron'
  /** De controle zakte: verzonnen bron of ongedekt getal. */
  | 'niet_herleidbaar'
  /** Het model gaf onleesbare output. */
  | 'onleesbaar';

export interface AssistantGroundingRef {
  statement: string;
  sourceId: string;
  /** Het label van de bron, zodat de cockpit iets te tonen heeft. */
  sourceLabel: string;
}

export type AssistantResult =
  | {
      ok: true;
      answer: string;
      /** De gevalideerde citaten, in de volgorde van het antwoord. */
      grounding: AssistantGroundingRef[];
      /** De bronnen die daadwerkelijk zijn geciteerd. */
      usedSources: AssistantSource[];
    }
  | {
      ok: false;
      reason: RefusalReason;
      /** Wat de medewerker te zien krijgt. Nooit het afgekeurde antwoord. */
      message: string;
      /** Voor het beslislog: wat er precies niet klopte. */
      detail: {
        onbekendeBronnen: string[];
        ongedekteGetallen: string[];
      };
    };

/**
 * Haalt het JSON-object uit een (mogelijk in ```-fences verpakte) respons.
 * Null bij onleesbare output — dat is een weigering, geen exception.
 */
export function parseAssistantAnswer(raw: string): ParsedAssistantAnswer | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = (fenced ? fenced[1] : raw).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
  const cannotAnswer =
    typeof obj.cannotAnswer === 'string' && obj.cannotAnswer.trim().length > 0
      ? obj.cannotAnswer.trim()
      : null;
  if (!answer && !cannotAnswer) return null;

  const claims: AssistantClaim[] = [];
  if (Array.isArray(obj.claims)) {
    for (const entry of obj.claims) {
      if (!entry || typeof entry !== 'object') continue;
      const c = entry as Record<string, unknown>;
      if (typeof c.statement !== 'string' || typeof c.sourceId !== 'string') continue;
      const statement = c.statement.trim();
      const sourceId = c.sourceId.trim();
      if (!statement || !sourceId) continue;
      claims.push({ statement, sourceId });
    }
  }

  return { answer, claims, cannotAnswer };
}

/**
 * Valideert een geparst antwoord tegen de bronnen die het model kreeg, en
 * beslist of het naar buiten mag.
 *
 * Bewust hier en niet bij de aanroeper: dit is een harde regel van het product,
 * en een regel die je per call kunt overslaan is geen regel.
 */
export function finalizeAssistantAnswer(
  parsed: ParsedAssistantAnswer | null,
  sources: readonly AssistantSource[],
): AssistantResult {
  if (!parsed) {
    return {
      ok: false,
      reason: 'onleesbaar',
      message:
        'Ik kon geen bruikbaar antwoord vormen. Probeer de vraag anders te stellen.',
      detail: { onbekendeBronnen: [], ongedekteGetallen: [] },
    };
  }

  if (parsed.cannotAnswer) {
    return {
      ok: false,
      reason: 'geen_bron',
      message: parsed.cannotAnswer,
      detail: { onbekendeBronnen: [], ongedekteGetallen: [] },
    };
  }

  const byId = new Map(sources.map((s) => [s.id, s]));

  // Controle 1 — verwijst elk citaat naar een bron die bestaat?
  const onbekendeBronnen: string[] = [];
  const grounding: AssistantGroundingRef[] = [];
  const used = new Map<string, AssistantSource>();
  for (const claim of parsed.claims) {
    const source = byId.get(claim.sourceId);
    if (!source) {
      if (!onbekendeBronnen.includes(claim.sourceId)) {
        onbekendeBronnen.push(claim.sourceId);
      }
      continue;
    }
    grounding.push({
      statement: claim.statement,
      sourceId: claim.sourceId,
      sourceLabel: source.label,
    });
    used.set(source.id, source);
  }

  // Controle 2 — staat elk getal uit het antwoord in ten minste één bron?
  //
  // Tegen álle aangeleverde bronnen en niet alleen de geciteerde: de assistent
  // zag niets anders, dus een getal dat ergens in zijn context staat, is niet
  // verzonnen. Zou dit alleen tegen de geciteerde bronnen lopen, dan sloeg de
  // controle aan op correcte antwoorden — en een guardrail die vals alarm geeft,
  // wordt genegeerd.
  const haystack = sources.map((s) => s.text).join('\n');
  const ongedekteGetallen = extractNumericTokens(parsed.answer).filter(
    (token) => !haystack.includes(token),
  );

  if (onbekendeBronnen.length > 0 || ongedekteGetallen.length > 0) {
    return {
      ok: false,
      reason: 'niet_herleidbaar',
      message:
        'Ik kon dit antwoord niet volledig herleiden naar het dossier en houd het ' +
        'daarom in. Stel de vraag concreter, of kijk in de bronnen hiernaast.',
      detail: { onbekendeBronnen, ongedekteGetallen },
    };
  }

  return {
    ok: true,
    answer: parsed.answer,
    grounding,
    usedSources: [...used.values()],
  };
}
