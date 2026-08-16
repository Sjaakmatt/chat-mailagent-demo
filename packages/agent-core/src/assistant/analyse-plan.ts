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
  | { ok: false; reden: string };

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
  if (!parsed) {
    return { ok: false, reden: 'Ik kon de vraag niet omzetten naar een aggregatie.' };
  }
  if (parsed.cannotAnswer) {
    return { ok: false, reden: parsed.cannotAnswer };
  }
  if (!parsed.tool) {
    return {
      ok: false,
      reden: 'Ik heb geen aggregatie kunnen kiezen die deze vraag beantwoordt.',
    };
  }

  const entry = catalog.find((c) => c.tool === parsed.tool);
  if (!entry) {
    // Het model verzon een tool. Niet benaderen met iets wat er wél is.
    return {
      ok: false,
      reden:
        `Die aggregatie bestaat hier niet (${parsed.tool}). ` +
        'Ik benader hem niet met een andere; vraag of hij gebouwd kan worden.',
    };
  }

  const args = parsed.args ?? {};
  const van = typeof args.van === 'string' ? args.van : null;
  const tot = typeof args.tot === 'string' ? args.tot : null;
  if (!van || !tot) {
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
