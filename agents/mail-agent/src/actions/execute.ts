/**
 * Het uitvoeren van een goedgekeurde schrijfoperatie.
 *
 * Dit is de enige plek in de hele lus waar er echt iets in een ander systeem
 * verandert. Alles ervóór — voorstellen, opslaan, tonen, goedkeuren — laat de
 * buitenwereld ongemoeid. Dat is het principe uit `agent-core/actions`: er is
 * geen terugdraaipad nodig, want tot dit punt valt er niets terug te draaien.
 *
 * ## Twee routes naar hetzelfde doel
 *
 * De standaard is een MCP-call: elk actietype noemt in zijn registratie een
 * `target` (welke MCP, welke tool), en die roepen we aan. Dat is de route die
 * bij een echte klant draait.
 *
 * Daarnaast is er `ACTION_EXECUTORS`, leeg in het fundament. Een klant- of
 * demo-repo kan daar een eigen uitvoerder registreren voor een type. Dat is
 * geen omweg om de MCP-laag heen maar de naad die een demo bruikbaar maakt: de
 * agentcode, de poorten en het goedkeurscherm blijven identiek, alleen het
 * doelsysteem is een ander.
 *
 * ## Wat hier NIET gebeurt
 *
 * Beslissen. Of deze actie mág, is al bepaald door `evaluateApproval` — status,
 * vervaldatum, rol en de hervalidatie van de preconditie. Die controle hier
 * herhalen zou hem op twee plekken doen wonen, en dan is er een plek die
 * achterloopt.
 */

import { getActionType, type ProposedAction } from '@factumai/agent-core';
import { callMcp, cfAccessHeaders, mcpBearer } from '@factumai/agent-core/mcp';
import type { Env } from '../env.js';

export interface ActionExecutionContext {
  env: Env;
  action: ProposedAction;
}

export interface ActionExecutor {
  /** Het actietype waarvoor deze uitvoerder in de plaats komt. */
  type: string;
  /** Voert uit en geeft een verwijzing terug voor de auditlog. */
  run(ctx: ActionExecutionContext): Promise<{ ref?: string }>;
}

/**
 * Eigen uitvoerders. Leeg in het fundament — een verse klant-agent schrijft via
 * de MCP's die in de registratie staan.
 *
 * Aanhaken:
 *   import { demoExecutors } from './demo/index.js';
 *   export const ACTION_EXECUTORS: ActionExecutor[] = demoExecutors;
 */
export const ACTION_EXECUTORS: ActionExecutor[] = [];

/** De MCP-endpoint van dit doel, uit de env. */
function mcpUrlFor(env: Env, mcp: string): string | undefined {
  const key = `FACTUMAI_MCP_${mcp.toUpperCase()}_URL` as keyof Env;
  const waarde = env[key];
  return typeof waarde === 'string' && waarde.length > 0 ? waarde : undefined;
}

/**
 * Voert de actie uit. Gooit als het misgaat — de aanroeper zet 'm dan op
 * `mislukt`, en dat is een status waaruit opnieuw proberen mag.
 *
 * De idempotentiesleutel gaat mee naar het doelsysteem. Ook waar een vendor er
 * niets mee doet, is dat de enige verdediging tegen twee keer klikken, een
 * dubbel tabblad of een netwerkfout halverwege.
 */
export async function executeAction(ctx: ActionExecutionContext): Promise<{ ref?: string }> {
  const { env, action } = ctx;

  const eigen = ACTION_EXECUTORS.find((e) => e.type === action.type);
  if (eigen) return eigen.run(ctx);

  const def = getActionType(action.type);
  if (!def) {
    // Het type is uit de registratie verdwenen terwijl het voorstel er nog lag.
    // Niet gokken op basis van de payload: dan schrijven we iets waarvan
    // niemand meer heeft vastgelegd wat het doet.
    throw new Error(
      `actietype ${action.type} bestaat niet meer in de registratie — niets uitgevoerd`,
    );
  }

  const url = mcpUrlFor(env, def.target.mcp);
  if (!url) {
    throw new Error(
      `geen endpoint voor MCP '${def.target.mcp}' (zet FACTUMAI_MCP_${def.target.mcp.toUpperCase()}_URL), ` +
        `of registreer een eigen uitvoerder voor ${action.type}`,
    );
  }

  const res = await callMcp<{ id?: string; reference?: string }>(
    { url, apiKey: mcpBearer(env), cfAccess: cfAccessHeaders(env) },
    {
      organizationId: action.organizationId,
      agentId: 'aios-agent',
      toolCallId: action.idempotencyKey,
    },
    def.target.tool,
    { ...action.payload, idempotencyKey: action.idempotencyKey },
  );

  if (!res.ok) {
    throw new Error(`${def.target.mcp}.${def.target.tool} faalde: ${res.error ?? 'onbekend'}`);
  }
  return { ref: res.data?.id ?? res.data?.reference };
}
