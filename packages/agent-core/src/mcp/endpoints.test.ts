import { describe, expect, it } from 'vitest';

/**
 * De afleiding van MCP-URL's uit hun registernaam.
 *
 * Staat als test in agent-core en niet in de cockpit omdat de cockpit geen
 * testrunner heeft; de logica zelf is een kopie van vier regels in
 * `ui/lib/assistant/mcp-endpoints.ts`. Wijzigt de conventie, dan valt deze test
 * om en weet je dat je op twee plekken moet kijken.
 *
 * De conventie: elke MCP heeft een eigen custom domain met Cloudflare Access
 * ervoor — `https://mcp-tickets.factumai.nl/mcp`. Een subdomein dus, geen pad.
 */

function subdomainFor(mcpName: string): string {
  const match = mcpName.match(/(mcp-.+)$/);
  return match ? match[1] : mcpName;
}

function urlVarFor(mcpName: string): string {
  const suffix = subdomainFor(mcpName).replace(/^mcp-/, '').replace(/-/g, '_').toUpperCase();
  return `FACTUMAI_MCP_${suffix}_URL`;
}

function mcpUrl(
  env: Record<string, string | undefined>,
  mcpName: string,
): string {
  const override = env[urlVarFor(mcpName)]?.trim();
  if (override) return override;
  const domain = env.MCP_DOMAIN?.trim() || 'factumai.nl';
  return `https://${subdomainFor(mcpName)}.${domain}/mcp`;
}

describe('MCP-endpoints', () => {
  it('leidt het subdomein af uit de registernaam', () => {
    expect(mcpUrl({}, 'factumai-mcp-tickets')).toBe('https://mcp-tickets.factumai.nl/mcp');
    expect(mcpUrl({}, 'factumai-mcp-scheduling')).toBe(
      'https://mcp-scheduling.factumai.nl/mcp',
    );
  });

  it('houdt een domein met een streepje heel', () => {
    expect(mcpUrl({}, 'factumai-mcp-market-intel')).toBe(
      'https://mcp-market-intel.factumai.nl/mcp',
    );
  });

  it('overleeft de geplande hernoeming naar internal-mcp-*', () => {
    // De afleiding strips alles tot en met het voorvoegsel, dus de bekende
    // afwijking uit factumai-mcps/CLAUDE.md breekt hem niet.
    expect(mcpUrl({}, 'internal-mcp-tickets')).toBe('https://mcp-tickets.factumai.nl/mcp');
  });

  it('laat een expliciete var winnen van de afleiding', () => {
    // Voor een MCP die tijdelijk ergens anders draait, of een lokale tunnel.
    expect(
      mcpUrl(
        { FACTUMAI_MCP_TICKETS_URL: 'http://localhost:8787/mcp' },
        'factumai-mcp-tickets',
      ),
    ).toBe('http://localhost:8787/mcp');
  });

  it('negeert een lege var in plaats van een kapotte URL te bouwen', () => {
    expect(mcpUrl({ FACTUMAI_MCP_TICKETS_URL: '   ' }, 'factumai-mcp-tickets')).toBe(
      'https://mcp-tickets.factumai.nl/mcp',
    );
  });

  it('laat het domein overschrijven voor een andere omgeving', () => {
    expect(mcpUrl({ MCP_DOMAIN: 'staging.factumai.nl' }, 'factumai-mcp-erp')).toBe(
      'https://mcp-erp.staging.factumai.nl/mcp',
    );
  });

  it('leidt de override-varnaam af volgens dezelfde conventie', () => {
    expect(urlVarFor('factumai-mcp-tickets')).toBe('FACTUMAI_MCP_TICKETS_URL');
    expect(urlVarFor('factumai-mcp-market-intel')).toBe('FACTUMAI_MCP_MARKET_INTEL_URL');
  });
});
