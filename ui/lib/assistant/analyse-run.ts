/**
 * Eén analyse-vraag, van catalogus tot gevalideerd antwoord.
 *
 *   catalogus → model kiest → **MCP rekent** → resultaat wordt bron →
 *   bestaand antwoordpad → controle
 *
 * De laatste twee stappen zijn letterlijk die van laag 1. Dat is met opzet: de
 * grounding-controle die daar al staat, dekt hiermee ook de cijfers. Een getal
 * dat niet uit de aggregatie komt, haalt het antwoord niet.
 *
 * Wat hier níét gebeurt: rekenen. De cockpit telt niets op en rondt niets af;
 * hij vraagt het de MCP en geeft het antwoord door.
 */

import {
  aggregationSource,
  buildAnalysePlanPrompt,
  parseAnalysePlan,
  resolveAnalysePlan,
  type AggregationCatalogEntry,
  type AggregationSummary,
  type AssistantSource,
} from "@factumai/agent-core";
import { callMcp, cfAccessHeaders, mcpBearer } from "@factumai/agent-core/mcp";
import type { CockpitEnv } from "@/lib/env";
import type { DataCategory } from "@factumai/agent-core";

/**
 * De aggregaties die deze tenant kan uitvoeren.
 *
 * Vandaag handmatig; de namen komen uit `list_field_categories` van de MCP's,
 * de omschrijvingen zijn wat het model nodig heeft om te kiezen. Zodra er een
 * derde MCP aggregaties aanbiedt, hoort dit uit de MCP zelf te komen — een
 * omschrijving die hier verouderd raakt, laat het model de verkeerde kiezen.
 */
export const AGGREGATION_CATALOG: readonly AggregationCatalogEntry[] = [
  {
    tool: "aggregate_complaint_rate",
    mcp: "factumai-mcp-tickets",
    omschrijving: "Welk deel van de tickets in een periode een klacht is (percentage)",
    extraArgumenten: {
      labelFilter: "reken alleen over tickets met dit label, bv. een productgroep",
      complaintLabels: "labels die als klacht tellen; default klacht en escalatie",
    },
  },
  {
    tool: "aggregate_resolution_time",
    mcp: "factumai-mcp-tickets",
    omschrijving: "Gemiddelde doorlooptijd van opgeloste tickets, in dagen",
  },
];

export type AnalyseOutcome =
  | { ok: true; source: AssistantSource; aggregatie: AggregationSummary; tool: string }
  | { ok: false; reden: string };

interface AggregationEnvelope {
  data?: AggregationSummary;
  classificatie?: { weggelaten: { pad: string; reden: string }[] };
}

/**
 * Voert de gekozen aggregatie uit tegen de MCP.
 *
 * Faalt de call, dan is dat een weigering met de reden erbij — niet een getal
 * uit een andere bron. En als de veldclassificatie de verantwoording heeft
 * weggesneden, weigeren we óók: een cijfer zonder populatie of definitie is
 * precies wat de briefing verbiedt.
 */
async function runAggregation(
  env: CockpitEnv,
  mcp: string,
  tool: string,
  args: Record<string, unknown>,
  categories: readonly DataCategory[],
): Promise<AnalyseOutcome> {
  const baseUrl = env.MCP_BASE_URL?.trim();
  if (!baseUrl) {
    return { ok: false, reden: "De koppeling met de aggregaties is niet ingesteld." };
  }

  const res = await callMcp<AggregationEnvelope>(
    {
      url: `${baseUrl.replace(/\/$/, "")}/${mcp}/mcp`,
      apiKey: mcpBearer(env),
      cfAccess: cfAccessHeaders(env),
    },
    {
      organizationId: env.AIOS_ORG_ID,
      agentId: "cockpit-assistent",
      toolCallId: `assistent:${tool}:${args.van}:${args.tot}`,
      dataCategories: [...categories],
    },
    tool,
    args,
  );

  if (!res.ok || !res.data?.data) {
    return {
      ok: false,
      reden: res.error
        ? `De aggregatie kon niet worden uitgevoerd: ${res.error}`
        : "De aggregatie gaf geen bruikbaar resultaat.",
    };
  }

  const aggregatie = res.data.data;
  const weggelaten = res.data.classificatie?.weggelaten ?? [];
  const verantwoordingWeg = weggelaten.filter((w) =>
    ["waarde", "populatie", "definitie", "periode.van", "periode.tot"].includes(w.pad),
  );
  if (verantwoordingWeg.length > 0) {
    return {
      ok: false,
      reden:
        "Dit cijfer valt deels buiten je rechten, en zonder populatie en definitie " +
        "is het niet te controleren. Vraag het iemand met meer rechten.",
    };
  }

  return {
    ok: true,
    tool,
    aggregatie,
    source: aggregationSource(tool, aggregatie),
  };
}

/**
 * Fase 1 + 2: het model kiest, de MCP rekent.
 *
 * `askModel` is de LLM-aanroep, doorgegeven zodat deze functie zonder netwerk
 * te testen is en de model-keuze op één plek in `run.ts` blijft.
 */
export async function planAndRunAggregation(
  env: CockpitEnv,
  question: string,
  categories: readonly DataCategory[],
  vandaag: string,
  askModel: (messages: ReturnType<typeof buildAnalysePlanPrompt>) => Promise<string>,
): Promise<AnalyseOutcome> {
  let raw: string;
  try {
    raw = await askModel(buildAnalysePlanPrompt(question, AGGREGATION_CATALOG, vandaag));
  } catch {
    return { ok: false, reden: "De assistent is nu niet bereikbaar." };
  }

  const plan = resolveAnalysePlan(parseAnalysePlan(raw), AGGREGATION_CATALOG);
  if (!plan.ok) return { ok: false, reden: plan.reden };

  return runAggregation(env, plan.mcp, plan.tool, plan.args, categories);
}
