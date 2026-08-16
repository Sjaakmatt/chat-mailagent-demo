import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TenantContext } from '../tenant/index.js';

/**
 * Dunne MCP-client: connect-per-call over streamable HTTP
 * (`/mcp`), bearer-auth, en de tenant-context-envelope op elke tool-call —
 * conform de blueprint (geen secrets meesturen, tenant-context altijd). Een
 * falende MCP-call gooit; de orchestratie-stappen vangen dat op.
 */
export interface McpCallResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Resolve het bearer-token voor inbound-auth naar de FactumAI-MCPs. De MCPs
 * dwingen sinds audit K3 een gedeeld secret af (`MCP_INBOUND_SECRET`); zonder
 * die header wordt elke `/mcp`-request 401. Voorkeur `FACTUMAI_MCP_INBOUND_SECRET`;
 * `FACTUMAI_MCP_API_KEY` blijft als fallback voor lokale/legacy setups.
 * Alleen relevant voor de oude `*.workers.dev`-URL's — de custom domains
 * (`mcp-<x>.factumai.nl`) doen inbound-auth via Cloudflare Access i.p.v. bearer.
 */
export function mcpBearer(env: {
  FACTUMAI_MCP_INBOUND_SECRET?: string;
  FACTUMAI_MCP_API_KEY?: string;
}): string | undefined {
  return env.FACTUMAI_MCP_INBOUND_SECRET || env.FACTUMAI_MCP_API_KEY || undefined;
}

/**
 * Cloudflare Access service-token voor de custom-domain MCPs
 * (`https://mcp-<x>.factumai.nl/mcp`). Access blokkeert anonieme requests aan
 * de edge (403). De twee headers moeten op ELKE fetch mee — zowel `initialize`
 * als elke `tools/call`. Ontbreekt één van beide, dan sturen we niks mee
 * (b.v. lokale MCPs zonder Access ervoor).
 */
export function cfAccessHeaders(env: {
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}): Record<string, string> {
  const id = env.CF_ACCESS_CLIENT_ID?.trim();
  const secret = env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (!id || !secret) return {};
  return {
    'CF-Access-Client-Id': id,
    'CF-Access-Client-Secret': secret,
  };
}

export interface McpEndpoint {
  url: string;
  /** Legacy bearer voor `*.workers.dev` — negeer bij custom-domain MCPs. */
  apiKey?: string;
  /**
   * Cloudflare Access service-token headers. Verplicht voor
   * `mcp-<x>.factumai.nl` (anders 403 van Access). Meestal via
   * `cfAccessHeaders(env)`.
   */
  cfAccess?: Record<string, string>;
  /**
   * Wélke instance van deze MCP. Eén org kan er meerdere hebben: drie
   * mailboxen, twee administraties, twee advertentieaccounts.
   *
   * **Leeg is niet neutraal.** De MCP valt dan terug op de instance die als
   * primair is gemarkeerd, en dat is precies de instance die je bij een agent
   * meestal níét wilt — bij mail is dat het adres waar echte klanten naartoe
   * schrijven. En omdat deze agent ook verstuurt, is die default niet alleen
   * lezen uit de verkeerde bak maar ook antwoorden vanuit het verkeerde adres.
   *
   * Zet 'm dus expliciet zodra een org meer dan één instance heeft.
   */
  instanceKey?: string;
}

/**
 * Het mail-endpoint, op één plek. De agent bouwde dit op twee plekken los op
 * (ophalen bij binnenkomst, versturen na goedkeuring); zodra er een derde ding
 * bij komt — een instance, een header — loopt dat gegarandeerd uit elkaar. En
 * bij mail is "uit elkaar" concreet: lezen uit de ene mailbox en antwoorden
 * vanuit de andere.
 *
 * Geeft `null` als er geen URL geconfigureerd is, zodat de caller zelf kan
 * beslissen of dat een overslaan of een fout is.
 */
export function mailEndpoint(env: {
  FACTUMAI_MCP_MAIL_URL?: string;
  FACTUMAI_MCP_MAIL_INSTANCE_KEY?: string;
  FACTUMAI_MCP_INBOUND_SECRET?: string;
  FACTUMAI_MCP_API_KEY?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}): McpEndpoint | null {
  if (!env.FACTUMAI_MCP_MAIL_URL) return null;
  return {
    url: env.FACTUMAI_MCP_MAIL_URL,
    apiKey: mcpBearer(env),
    cfAccess: cfAccessHeaders(env),
    instanceKey: env.FACTUMAI_MCP_MAIL_INSTANCE_KEY?.trim() || undefined,
  };
}

export async function callMcp<T = unknown>(
  endpoint: McpEndpoint,
  ctx: TenantContext,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpCallResult<T>> {
  // URL-parsing binnen de try: een ongeldige/relatieve MCP-URL (bv. zonder
  // scheme) gooit anders synchroon `Invalid URL string` en laat de hele
  // orchestratie crashen — terwijl een falende MCP-call moet fail-soften
  // (CLAUDE.md: val terug op skip, nooit de mail-pipeline laten crashen).
  let transport: StreamableHTTPClientTransport;
  let client: Client;
  try {
    const headers: Record<string, string> = {
      ...(endpoint.cfAccess ?? {}),
      ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
    };
    transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
    });
    client = new Client({ name: 'aios-agent', version: '0.1.0' });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    await client.connect(transport);
    // De instance hoort bij het endpoint, niet bij de call: elke tool op deze
    // MCP moet dezelfde mailbox/administratie raken. Nestelen in de
    // tenant-context is wat de MCP-kant verwacht (`TenantContextSchema`).
    const tenantContext = endpoint.instanceKey
      ? { ...ctx, instanceKey: endpoint.instanceKey }
      : ctx;
    const result = await client.callTool({
      name: toolName,
      arguments: { tenantContext, ...args },
    });
    if ((result as { isError?: boolean }).isError) {
      const content = (result as { content?: Array<{ text?: string }> }).content;
      return { ok: false, error: content?.[0]?.text ?? `${toolName} gaf een fout` };
    }
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
    const first = content?.[0];
    if (!first || first.type !== 'text' || !first.text) return { ok: true, data: undefined };
    try {
      return { ok: true, data: JSON.parse(first.text) as T };
    } catch {
      return { ok: true, data: first.text as unknown as T };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await client.close().catch(() => {});
  }
}
