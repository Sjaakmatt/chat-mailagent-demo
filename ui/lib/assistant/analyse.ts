/**
 * De schakelaar van laag 2 — de analyse-laag.
 *
 * De vlag staat in config, maar hij **beslist niet alleen**. De drie
 * voorwaarden uit de bouwbriefing worden gecontroleerd bij het opvragen, niet
 * vertrouwd: alle velden geclassificeerd, minstens één aggregatietool, minstens
 * één rol die commercieel of financieel mag zien.
 *
 * Voldoet er iets niet, dan blijft de laag uit mét de reden erbij. Geen halve
 * activering: een analyse-assistent die aanstaat maar bij de helft van de
 * velden niets kan, wekt de indruk dat er niets te halen valt.
 *
 * De rapporten komen van de MCP's zelf (`list_field_categories`), niet uit een
 * registerbestand — de controle mag niet leunen op een lijst die iemand had
 * moeten bijwerken.
 */

import {
  evaluateAnalyseGate,
  isAggregationToolName,
  resolveAccess,
  ROLES,
  type AnalyseGateResult,
  type DataCategory,
  type McpClassificationReport,
  type Role,
  type RoleGrant,
} from "@factumai/agent-core";
import { callMcp, cfAccessHeaders, mcpBearer } from "@factumai/agent-core/mcp";
import type { CockpitEnv } from "@/lib/env";
import { MODULES } from "@/lib/modules";
import { mcpUrl } from "./mcp-endpoints";

/** Staat de vlag aan in config? Zegt nog niets over de voorwaarden. */
export function analyseFlagSet(env: CockpitEnv): boolean {
  return env.ASSISTANT_ANALYSE === "true";
}

/**
 * De MCP's die deze cockpit mag bevragen voor de controle.
 *
 * Uit de assistent-scope van de geregistreerde modules: precies de MCP's waar
 * deze tenant iets mee doet. Een MCP die nergens gekoppeld is, hoeft de
 * schakelaar niet tegen te houden.
 */
export function coupledMcps(): string[] {
  const seen = new Set<string>();
  for (const mod of MODULES) {
    for (const mcp of mod.assistant?.mcps ?? []) seen.add(mcp);
  }
  return [...seen].sort();
}

interface FieldCategoriesResponse {
  mcp?: string;
  volledigGeclassificeerd?: boolean;
  ongeclassificeerdeTools?: string[];
  tools?: { tool: string }[];
}

/**
 * Vraagt één MCP naar zijn eigen veldclassificatie.
 *
 * Faalt de call, dan komt er géén rapport terug en telt die MCP als "kon zich
 * niet melden" — de gate rekent dat als niet gehaald. Fail-closed: onbereikbaar
 * is niet hetzelfde als in orde.
 */
async function fetchReport(
  env: CockpitEnv,
  organizationId: string,
  mcpName: string,
): Promise<McpClassificationReport | null> {
  const res = await callMcp<FieldCategoriesResponse>(
    { url: mcpUrl(env, mcpName), apiKey: mcpBearer(env), cfAccess: cfAccessHeaders(env) },
    {
      organizationId,
      agentId: "cockpit-analyse-gate",
      toolCallId: `analyse-gate:${mcpName}`,
      dataCategories: ["operationeel"],
    },
    "list_field_categories",
  );

  if (!res.ok || !res.data) return null;
  const body = res.data;
  const tools = (body.tools ?? []).map((t) => t.tool);
  return {
    mcp: body.mcp ?? mcpName,
    volledigGeclassificeerd: body.volledigGeclassificeerd === true,
    ongeclassificeerdeTools: body.ongeclassificeerdeTools ?? [],
    aggregatieTools: tools.filter(isAggregationToolName),
  };
}

export interface AnalyseStatus {
  /** Staat de vlag in config aan? */
  vlag: boolean;
  /** Voldoet de tenant aan de drie voorwaarden? */
  gate: AnalyseGateResult;
  /** Alleen dán is laag 2 actief. */
  actief: boolean;
  /** Welke MCP's zich niet konden melden. */
  onbereikbaar: string[];
}

/**
 * De volledige stand van de analyse-laag: vlag én voorwaarden.
 *
 * Doet netwerkcalls naar de MCP's. Bedoeld voor de beheerpagina en voor het
 * moment dat de laag wordt aangezet — niet voor elke vraag aan de assistent.
 */
export async function analyseStatus(
  env: CockpitEnv,
  grants: RoleGrant[],
): Promise<AnalyseStatus> {
  const mcps = coupledMcps();
  const settled = await Promise.all(
    mcps.map(async (name) => {
      try {
        return { name, report: await fetchReport(env, env.AIOS_ORG_ID, name) };
      } catch {
        return { name, report: null };
      }
    }),
  );

  const reports = settled
    .map((s) => s.report)
    .filter((r): r is McpClassificationReport => r !== null);
  const onbereikbaar = settled.filter((s) => s.report === null).map((s) => s.name);

  // Wat elke rol ergens mag zien — de vereniging over de modules, want één
  // module waar commercieel mag, is genoeg om de laag zinvol te maken.
  const categoriesPerRole: Partial<Record<Role, readonly DataCategory[]>> = {};
  const moduleIds = MODULES.map((m) => m.id);
  for (const role of ROLES) {
    const access = resolveAccess(role, grants);
    const seen = new Set<DataCategory>();
    for (const module of moduleIds) {
      for (const category of access.categoriesIn(module)) seen.add(category);
    }
    categoriesPerRole[role] = [...seen];
  }

  const gate = evaluateAnalyseGate({ reports, categoriesPerRole });
  return { vlag: analyseFlagSet(env), gate, actief: analyseFlagSet(env) && gate.mag, onbereikbaar };
}
