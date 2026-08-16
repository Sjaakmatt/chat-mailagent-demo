/**
 * Waar de MCP's van deze tenant staan.
 *
 * Elke MCP heeft een eigen custom domain met Cloudflare Access ervoor:
 *
 *     factumai-mcp-tickets     →  https://mcp-tickets.factumai.nl/mcp
 *     factumai-mcp-scheduling  →  https://mcp-scheduling.factumai.nl/mcp
 *
 * Dus een **subdomein** per MCP, niet een pad achter één host. Dat is af te
 * leiden uit de registernaam, waardoor de cockpit standaard werkt zonder dat je
 * per MCP een URL hoeft te zetten.
 *
 * De afleiding is wél te overrulen met dezelfde per-MCP-vars die de agent-Worker
 * gebruikt (`FACTUMAI_MCP_TICKETS_URL`). Die winnen altijd: een MCP die tijdelijk
 * ergens anders draait, of een lokale tunnel tijdens ontwikkelen, hoort niet te
 * vragen om een codewijziging.
 */

import type { CockpitEnv } from "@/lib/env";

/** Domein waaronder de MCP-subdomeinen hangen. */
const DEFAULT_MCP_DOMAIN = "factumai.nl";

/**
 * `factumai-mcp-tickets` → `mcp-tickets`.
 *
 * De registernaam draagt het `factumai-`-voorvoegsel, het subdomein niet. Zie
 * ook de bekende afwijking in `factumai-mcps/CLAUDE.md`: de MCP's heten nu
 * `factumai-mcp-*` en gaan richting `internal-mcp-*`. Deze afleiding overleeft
 * die hernoeming, want hij strips alleen het voorvoegsel tot en met `mcp-`.
 */
export function subdomainFor(mcpName: string): string {
  const match = mcpName.match(/(mcp-.+)$/);
  return match ? match[1] : mcpName;
}

/** `factumai-mcp-tickets` → `FACTUMAI_MCP_TICKETS_URL`. */
export function urlVarFor(mcpName: string): string {
  const suffix = subdomainFor(mcpName)
    .replace(/^mcp-/, "")
    .replace(/-/g, "_")
    .toUpperCase();
  return `FACTUMAI_MCP_${suffix}_URL`;
}

/**
 * De URL van deze MCP: een expliciete var als die er is, anders afgeleid.
 *
 * Geeft nooit een halve gok terug — de afleiding is de gedocumenteerde
 * conventie, en wijkt een omgeving daarvan af, dan zet je de var.
 */
export function mcpUrl(env: CockpitEnv, mcpName: string): string {
  const override = (env as unknown as Record<string, string | undefined>)[
    urlVarFor(mcpName)
  ]?.trim();
  if (override) return override;

  const domain = env.MCP_DOMAIN?.trim() || DEFAULT_MCP_DOMAIN;
  return `https://${subdomainFor(mcpName)}.${domain}/mcp`;
}
