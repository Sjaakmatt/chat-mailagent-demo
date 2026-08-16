/**
 * De schakelaar van laag 2 — en de controle die eraan vastzit.
 *
 * Aanzetten met één druk op de knop kan alleen als er per tenant vooraf iets is
 * gebeurd. De bouwbriefing noemt drie voorwaarden, en het systeem **controleert
 * ze bij het omzetten in plaats van ze te vertrouwen**:
 *
 *   1. Alle velden in de gekoppelde MCP's van deze tenant hebben een categorie.
 *   2. Er is minstens één aggregatietool beschikbaar.
 *   3. Er is minstens één gebruiker met een rol die commerciële of financiële
 *      categorieën mag zien.
 *
 * Voldoet er iets niet, dan blijft de vlag uit **met de reden erbij**. Geen
 * halve activering: een analyse-assistent die aanstaat maar bij de helft van de
 * velden niets kan, is erger dan één die uitstaat — hij wekt de indruk dat er
 * niets te halen valt.
 *
 * Waarom voorwaarde 1 zo hard is: zonder classificatie is een veld voor niemand
 * opvraagbaar, dus een ongeclassificeerde MCP levert lege antwoorden op waar de
 * gebruiker geen verklaring voor heeft. En erger — het is precies het geval
 * waarin iemand geneigd is de classificatie maar over te slaan "omdat het toch
 * niet werkt".
 */

import type { DataCategory, Role } from '../access/index.js';

/**
 * Wat één MCP over zichzelf zegt, uit zijn `list_field_categories`-tool.
 *
 * Bewust opgehaald bij de MCP zelf en niet uit een registerbestand: de
 * voorwaardencontrole mag niet leunen op een lijst die iemand had moeten
 * bijwerken. Zie `docs/VELDCLASSIFICATIE.md` in `factumai-mcps`.
 */
export interface McpClassificationReport {
  mcp: string;
  volledigGeclassificeerd: boolean;
  ongeclassificeerdeTools: readonly string[];
  /** Namen van de tools die een aggregatie teruggeven. */
  aggregatieTools: readonly string[];
}

/** Eén voorwaarde: gehaald, of niet gehaald met een reden die dat uitlegt. */
export type ConditionStatus =
  | { ok: true }
  | { ok: false; reden: string };

export interface AnalyseGateInput {
  /** Eén rapport per MCP die aan deze tenant is gekoppeld. */
  reports: readonly McpClassificationReport[];
  /**
   * De categorieën die elke rol ergens mag zien. Voorwaarde 3 kijkt of er
   * iemand is voor wie de analyse-laag überhaupt iets kan betekenen.
   */
  categoriesPerRole: Readonly<Partial<Record<Role, readonly DataCategory[]>>>;
}

export interface AnalyseGateResult {
  /** Alleen `true` als alle drie de voorwaarden zijn gehaald. */
  mag: boolean;
  velden: ConditionStatus;
  aggregaties: ConditionStatus;
  rollen: ConditionStatus;
  /** De redenen van de gezakte voorwaarden, klaar om te tonen. */
  redenen: string[];
}

/** Categorieën waarvoor de analyse-laag bestaat. */
const ANALYSE_CATEGORIES: readonly DataCategory[] = ['commercieel', 'financieel'];

export function evaluateAnalyseGate(input: AnalyseGateInput): AnalyseGateResult {
  const velden = checkVelden(input.reports);
  const aggregaties = checkAggregaties(input.reports);
  const rollen = checkRollen(input.categoriesPerRole);

  const redenen = [velden, aggregaties, rollen]
    .filter((c): c is { ok: false; reden: string } => !c.ok)
    .map((c) => c.reden);

  return { mag: redenen.length === 0, velden, aggregaties, rollen, redenen };
}

function checkVelden(reports: readonly McpClassificationReport[]): ConditionStatus {
  if (reports.length === 0) {
    // Geen enkele MCP bereikt: dat is geen "alles is geclassificeerd", dat is
    // "we weten het niet". Fail-closed.
    return {
      ok: false,
      reden: 'Geen enkele gekoppelde MCP kon zijn veldclassificatie melden.',
    };
  }

  const incompleet = reports.filter((r) => !r.volledigGeclassificeerd);
  if (incompleet.length === 0) return { ok: true };

  // De reden noemt wát er mist, niet alleen dát er iets mist — anders begint
  // degene die het moet oplossen met zoeken.
  const details = incompleet
    .map((r) => {
      const tools = r.ongeclassificeerdeTools;
      const opsomming =
        tools.length <= 3 ? tools.join(', ') : `${tools.slice(0, 3).join(', ')} +${tools.length - 3}`;
      return `${r.mcp} (${opsomming || 'onbekend welke tools'})`;
    })
    .join('; ');

  return {
    ok: false,
    reden: `Niet alle velden zijn geclassificeerd: ${details}.`,
  };
}

function checkAggregaties(reports: readonly McpClassificationReport[]): ConditionStatus {
  const totaal = reports.reduce((n, r) => n + r.aggregatieTools.length, 0);
  if (totaal > 0) return { ok: true };
  return {
    ok: false,
    reden:
      'Geen enkele gekoppelde MCP biedt een aggregatietool. Zonder aggregatie ' +
      'kan de analyse-laag alleen weigeren.',
  };
}

function checkRollen(
  categoriesPerRole: AnalyseGateInput['categoriesPerRole'],
): ConditionStatus {
  const kandidaten = Object.entries(categoriesPerRole).filter(([, categories]) =>
    (categories ?? []).some((c) => ANALYSE_CATEGORIES.includes(c)),
  );
  if (kandidaten.length > 0) return { ok: true };
  return {
    ok: false,
    reden:
      'Geen enkele rol mag commerciële of financiële gegevens zien, dus er is ' +
      'niemand voor wie de analyse-laag iets kan betekenen.',
  };
}

/**
 * Herkent een aggregatietool aan zijn naam.
 *
 * Naamconventie in plaats van een aparte registratie: een tool die `aggregate_`
 * heet en géén aggregatie teruggeeft, valt op bij de eerste aanroep — een tool
 * die vergeet zich te registreren, valt nergens op.
 */
export function isAggregationToolName(name: string): boolean {
  return name.startsWith('aggregate_');
}
