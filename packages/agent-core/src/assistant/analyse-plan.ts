/**
 * Laag 2 — hoe de assistent aan een cijfer komt.
 *
 * In twee fasen, en die scheiding is de hele veiligheid:
 *
 *   1. **Kiezen.** Het model krijgt de catalogus van beschikbare aggregaties en
 *      zegt welke het wil, met welke argumenten. Meer niet.
 *   2. **Rekenen.** De MCP voert die aggregatie uit en geeft het getal terug
 *      mét verantwoording. Het resultaat wordt een gewone bron, waarna het
 *      bestaande antwoordpad van laag 1 het overneemt — inclusief de controle
 *      dat elk getal in het antwoord uit een bron komt.
 *
 * Het model kiest dus wélke aggregatie zinvol is en interpreteert de uitkomst;
 * het rekent nergens. Een tool-use-lus waarin het model zelf tools aanroept zou
 * dat vervagen — hier is er letterlijk geen pad waarlangs een door het model
 * bedacht getal het antwoord in komt.
 *
 * **Bestaat de gevraagde aggregatie niet, dan weigeren.** Niet schatten, en
 * niet een andere aggregatie pakken die er ongeveer op lijkt. Dat is de tweede
 * helft van de gate van stap 5, en het is ook de reden dat het kiezen een aparte
 * fase is: een keuze buiten de catalogus is hier zichtbaar en te weigeren.
 */

import type { LlmMessage } from '../llm/index.js';
import { makeSource, type AssistantSource } from './sources.js';

/** Eén aggregatie die deze tenant kan uitvoeren. */
export interface AggregationCatalogEntry {
  /** Tool-naam, bv. `aggregate_complaint_rate`. */
  tool: string;
  /** De MCP die 'm aanbiedt. */
  mcp: string;
  /** Eén regel: wat meet deze aggregatie. */
  omschrijving: string;
  /** Argumentnamen buiten `van`/`tot`, met uitleg. Leeg = alleen een periode. */
  extraArgumenten?: Readonly<Record<string, string>>;
}

/**
 * Het resultaat van een aggregatie — agent-zijde spiegel van
 * `AggregationResult` in `@factumai/shared` (de MCP-laag).
 *
 * Bewust een kopie en geen import: `agent-core` is self-contained en leunt niet
 * op de MCP-laag. De zeven velden zijn een productafspraak en liggen vast.
 */
export interface AggregationSummary {
  waarde: number;
  eenheid: string;
  periode: { van: string; tot: string };
  populatie: number;
  definitie: string;
  uitgesloten: { aantal: number; reden: string }[];
  queryId: string;
}

/** Wat het model in fase 1 mag zeggen. */
export interface ParsedAnalysePlan {
  tool?: string | null;
  args?: Record<string, unknown> | null;
  /** Het model ziet geen passende aggregatie in de catalogus. */
  cannotAnswer?: string | null;
}

export type AnalysePlan =
  | { ok: true; tool: string; mcp: string; args: Record<string, unknown> }
  | {
      ok: false;
      reden: string;
      /**
       * Dit was helemaal geen aggregatievraag.
       *
       * Het verschil met een gewone weigering is het verschil tussen "ik kan
       * dit cijfer niet geven" en "hier werd geen cijfer gevraagd". Dat eerste
       * moet de gebruiker horen — anders vult hij de leegte met een getal dat
       * hij ergens anders vandaan haalt. Dat tweede is geen uitkomst maar een
       * routeringsbesluit: de vraag hoort in het dossierpad thuis.
       *
       * Zonder dit onderscheid weigert een assistent met laag 2 aan élke vraag
       * die niet toevallig een aggregatie is, en dat is precies wat er gebeurde:
       * "welk beleid geldt hier" kreeg als antwoord dat de aggregatie niet
       * bestond.
       */
      geenAggregatievraag?: boolean;
    };

const PLAN_SYSTEM = `Je kiest welke aggregatie een vraag van een medewerker beantwoordt.

Je rekent NIET. Je kiest alleen uit de catalogus hieronder; de aggregatie wordt
daarna door het systeem uitgevoerd.

REGELS
- Kies uitsluitend een tool die letterlijk in de catalogus staat.
- Staat er geen passende aggregatie in, vul dan "cannotAnswer" met één zin over
  wat er ontbreekt. Kies GEEN aggregatie die er ongeveer op lijkt en stel geen
  schatting voor — een verkeerd cijfer is erger dan geen cijfer.
- Een periode is verplicht: "van" (inclusief) en "tot" (EXCLUSIEF), als
  ISO-datum. Noemt de medewerker een maand, neem dan de eerste dag van die maand
  en de eerste dag van de maand erna.
- Noemt de medewerker geen periode, vul dan "cannotAnswer" — een cijfer zonder
  periode zegt niets.

ANTWOORDVORM
Uitsluitend JSON, geen tekst eromheen:
{ "tool": "aggregate_...", "args": { "van": "2026-07-01", "tot": "2026-08-01" }, "cannotAnswer": null }
of
{ "tool": null, "args": null, "cannotAnswer": "…" }`;

export function buildAnalysePlanPrompt(
  question: string,
  catalog: readonly AggregationCatalogEntry[],
  /** Vandaag, als ISO-datum — zodat "vorige maand" te vertalen is. */
  vandaag: string,
): LlmMessage[] {
  const lijst =
    catalog.length === 0
      ? '(geen aggregaties beschikbaar)'
      : catalog
          .map((c) => {
            const extra = Object.entries(c.extraArgumenten ?? {})
              .map(([k, v]) => `    - ${k}: ${v}`)
              .join('\n');
            return `- ${c.tool} (${c.mcp}): ${c.omschrijving}\n    - van, tot: de periode${extra ? `\n${extra}` : ''}`;
          })
          .join('\n');

  return [
    { role: 'system', content: PLAN_SYSTEM },
    {
      role: 'user',
      content: [
        `VANDAAG: ${vandaag}`,
        '',
        'CATALOGUS:',
        lijst,
        '',
        `VRAAG: ${question}`,
      ].join('\n'),
    },
  ];
}

/**
 * Woorden die verraden dat er om een grootheid wordt gevraagd.
 *
 * Ze worden gematcht op woordbegin, niet als losse tekenreeks. Dat is niet
 * kosmetisch: op tekenreeks matcht `tel` in "s**tel**t hij dit voor", en dan
 * gaat precies de vraag waarvoor dit filter bestaat alsnog langs de planner.
 * Met woordbegin dekt één term ook de verbuigingen — `gemiddeld` vangt
 * "gemiddelde", `aantal` vangt "aantallen".
 *
 * Niet uitputtend en dat hoeft ook niet — zie `mightBeAggregationQuestion` voor
 * waarom een gemiste term hier geen fout antwoord oplevert.
 */
const TELWOORDEN: readonly string[] = Object.freeze([
  // hoeveelheid
  'hoeveel', 'aantal', 'totaal', 'tel',
  // verhouding
  'percentage', 'procent', 'aandeel', 'verhouding', 'ratio', 'deel van',
  // middelen en spreiding
  'gemiddeld', 'mediaan', 'spreiding',
  // duur en frequentie
  'doorlooptijd', 'hoe vaak', 'hoe lang', 'hoe snel', 'frequentie',
  // beweging
  'trend', 'groei', 'daling', 'stijging', 'toename', 'afname',
  // vorm van het antwoord
  'cijfer', 'statistiek', 'meest', 'vaakst', 'top',
  // periode — een aggregatie zonder periode bestaat hier niet, dus een vraag
  // met een periode erin is een serieuze kandidaat
  'vorige maand', 'vorige week', 'afgelopen', 'dit jaar', 'vorig jaar',
  'dit kwartaal', 'per maand', 'per week', 'per dag', 'per kwartaal',
  'sinds', 'tussen',
]);

/**
 * Zou dit een aggregatievraag kúnnen zijn?
 *
 * Een voorfilter vóór de planner, en uitsluitend om kosten: zonder dit doet
 * elke vraag — ook "waarom stelt hij dit voor" — eerst een modelcall om te
 * horen dat er niets te tellen valt. Dat is een seconde en een call per vraag,
 * voor een antwoord dat je aan de vraag kunt zien.
 *
 * ## Waarom een heuristiek hier mag
 *
 * Omdat hij niets kan tegenhouden. De twee kanten zijn niet gelijkwaardig:
 *
 *   ten onrechte ja  → één overbodige modelcall, daarna gewoon het dossierpad
 *   ten onrechte nee → de vraag gaat naar het dossier, dat antwoordt op zijn
 *                      eigen bronnen of zegt eerlijk dat het er niet staat
 *
 * In geen van beide gevallen ontstaat er een getal dat er niet hoort te staan —
 * de grounding-controle staat achter béíde paden. Het ergste wat er misgaat is
 * "dat kan ik hier niet vinden" op een vraag die met een extra call wél was
 * gelukt. Daarom staat de lijst ruim: bij twijfel ja.
 *
 * Dit is dus geen poort. Poorten in dit product zijn mechanismen, geen
 * inschattingen; deze functie is een kostenbesparing met een begrensde
 * mislukking, en hij hoort nooit iets te zijn waar een controle op leunt.
 */
export function mightBeAggregationQuestion(question: string): boolean {
  const v = question.toLowerCase();
  // Een getal met een eenheid eraan ("laatste 30 dagen") telt ook mee.
  if (/\d+\s*(dag|week|weken|maand|kwartaal|jaar)/.test(v)) return true;
  if (v.includes('%')) return true;
  return TELWOORDEN.some((w) => new RegExp(`\\b${w}`).test(v));
}

/** Leest de keuze van het model. Null bij onleesbare output. */
export function parseAnalysePlan(raw: string): ParsedAnalysePlan | null {
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

  return {
    tool: typeof obj.tool === 'string' && obj.tool.trim() ? obj.tool.trim() : null,
    args:
      obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)
        ? (obj.args as Record<string, unknown>)
        : null,
    cannotAnswer:
      typeof obj.cannotAnswer === 'string' && obj.cannotAnswer.trim()
        ? obj.cannotAnswer.trim()
        : null,
  };
}

/**
 * Toetst de keuze aan de catalogus.
 *
 * Dit is de weigering uit de briefing, en hij staat hier en niet in de prompt:
 * een model dat wordt gevraagd niet te verzinnen, verzint soms toch. Een tool
 * die niet in de catalogus staat, komt hier niet doorheen.
 */
export function resolveAnalysePlan(
  parsed: ParsedAnalysePlan | null,
  catalog: readonly AggregationCatalogEntry[],
): AnalysePlan {
  // Deze drie zijn geen mislukking maar een routering: er werd niets geteld.
  // Onleesbaar antwoord valt er ook onder — we weten dan niet dát het een
  // aggregatievraag was, en doorlaten naar het dossier is veilig omdat dáár
  // dezelfde grounding-controle staat.
  if (!parsed) {
    return {
      ok: false,
      reden: 'Ik kon de vraag niet omzetten naar een aggregatie.',
      geenAggregatievraag: true,
    };
  }
  if (parsed.cannotAnswer) {
    return { ok: false, reden: parsed.cannotAnswer, geenAggregatievraag: true };
  }
  if (!parsed.tool) {
    return {
      ok: false,
      reden: 'Ik heb geen aggregatie kunnen kiezen die deze vraag beantwoordt.',
      geenAggregatievraag: true,
    };
  }

  const entry = catalog.find((c) => c.tool === parsed.tool);
  if (!entry) {
    // Het model verzon een tool. We benaderen hem niet met iets wat er wél is —
    // maar dit is ook geen reden om de vraag te laten vallen.
    //
    // Een gekozen tool die niet bestaat, betekent dat er géén echte aggregatie
    // is geselecteerd. Dat is hetzelfde als "hier valt niets te tellen", alleen
    // met een model dat liever iets verzint dan `cannotAnswer` invult. En dat
    // doet het vaak: bij "hoeveel tickets staan er open?" met een catalogus van
    // twee aggregaties komt er een `aggregate_open_tickets` uit die niet
    // bestaat. Weigeren op die vraag is onzin — het aantal staat gewoon in de
    // werkvoorraad-bron, en het dossierpad kan het daar gedekt uit halen.
    //
    // Doorlaten is veilig omdat het dossierpad niets kan verzinnen: elk getal
    // moet daar letterlijk in een bron staan.
    return {
      ok: false,
      reden:
        `Die aggregatie bestaat hier niet (${parsed.tool}). ` +
        'Ik benader hem niet met een andere.',
      geenAggregatievraag: true,
    };
  }

  const args = parsed.args ?? {};
  const van = typeof args.van === 'string' ? args.van : null;
  const tot = typeof args.tot === 'string' ? args.tot : null;
  if (!van || !tot) {
    // Hier is wél een bestaande aggregatie gekozen, alleen niet uitvoerbaar
    // zoals gevraagd. Dat is bruikbare feedback en geen routering: de gebruiker
    // hoort te weten dat hij een periode moet noemen.
    return {
      ok: false,
      reden: 'Ik heb een periode nodig — een cijfer zonder periode zegt niets.',
    };
  }

  return { ok: true, tool: entry.tool, mcp: entry.mcp, args };
}

/**
 * Maakt van een aggregatieresultaat een bron voor het antwoordpad.
 *
 * De zeven velden staan er allemaal in, en dat is niet netjesheid: de
 * grounding-controle dekt een getal alleen als het letterlijk in een bron
 * voorkomt. Zou hier alleen de waarde staan, dan zou de assistent de populatie
 * niet mogen noemen — precies het cijfer dat het percentage controleerbaar
 * maakt.
 */
export function aggregationSource(
  tool: string,
  result: AggregationSummary,
): AssistantSource {
  const uitgesloten =
    result.uitgesloten.length === 0
      ? 'niets uitgesloten'
      : result.uitgesloten.map((u) => `${u.aantal} (${u.reden})`).join('; ');

  return makeSource({
    id: `aggregatie:${result.queryId}`,
    kind: 'aggregatie',
    label: `Aggregatie ${tool}`,
    text: [
      `Waarde: ${result.waarde} ${result.eenheid}`,
      `Periode: ${result.periode.van} tot ${result.periode.tot} (tot is exclusief)`,
      `Populatie: ${result.populatie}`,
      `Definitie: ${result.definitie}`,
      `Uitgesloten: ${uitgesloten}`,
      `Query-id: ${result.queryId}`,
    ].join('\n'),
  });
}
