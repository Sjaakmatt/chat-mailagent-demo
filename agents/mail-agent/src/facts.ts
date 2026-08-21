/**
 * De feitenrunner — hoe een bron van een modulepakket daadwerkelijk wordt
 * aangeroepen.
 *
 * De kern bepaalt wélke bronnen draaien (`collectFacts`, op basis van de
 * `toolScope` van de gekozen specialist). Hier staat het enige stuk dat de
 * runtime kent: een MCP-call over streamable HTTP, of een tabel in de
 * klant-Supabase.
 *
 * Die scheiding is de reden dat agent-core geen Worker-code bevat en dat een
 * test de hele feitenlaag kan draaien zonder netwerk: die levert gewoon een
 * andere runner.
 *
 * **Fail-soft.** Alles wat misgaat komt terug als `{ ok: false }`, nooit als
 * een exception. Een bron die niet antwoordt levert geen feit, en zonder feit
 * kan het model geen cijfer onderbouwen — dat is precies de bedoeling van
 * harde regel 4.
 */

import {
  ServiceRoleCredentialStore,
  SupabaseClient,
  sourceLabel,
  type DataCategory,
  type FactRunResult,
  type FactRunner,
  type FactSource,
} from '@factumai/agent-core';
import { callMcp, cfAccessHeaders, mcpBearer } from '@factumai/agent-core/mcp';
import type { Env } from './env.js';

/**
 * Maakt de runner voor deze Worker.
 *
 * `organizationId` gaat op elke call mee, en `dataCategories` ook: de
 * verzamelaar heeft die al begrensd tot wat de agent mag, en de bron snijdt
 * zijn antwoord erop bij (`docs/RECHTEN.md`).
 */
export function factRunner(env: Env): FactRunner {
  // Eén client per run: elke tabel-lookup een nieuwe opzetten is verspilling,
  // en de credential wordt toch per request opgehaald.
  let db: SupabaseClient | null = null;

  return async ({ source, input, dataCategories, name }): Promise<FactRunResult> => {
    try {
      if (source.kind === 'table') {
        db ??= new SupabaseClient(
          new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
          { projectUrl: env.AIOS_SUPABASE_URL },
        );
        return await leesTabel(db, env, source.table, input, dataCategories);
      }

      const url = (env as unknown as Record<string, string | undefined>)[source.mcp]?.trim();
      if (!url) {
        // Geen URL betekent meestal: deze klant heeft dit systeem niet. Een
        // leesbare reden is hier belangrijker dan een stille lege uitkomst,
        // want dit is de vorm waarin een vergeten secret zich meldt.
        return { ok: false, error: `geen URL geconfigureerd (${source.mcp})` };
      }

      return await callMcp(
        { url, apiKey: mcpBearer(env), cfAccess: cfAccessHeaders(env) },
        ctxVoor(env, name, dataCategories),
        source.tool,
        input,
      );
    } catch (err) {
      // De runner gooit nooit: `collectFacts` vangt het wel af, maar dan is de
      // reden onherkenbaar geworden.
      return {
        ok: false,
        error: `${sourceLabel(source)}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

/**
 * Eén tabel-lookup.
 *
 * De invoer van de bron zijn PostgREST-parameters: `{ order_number: 'eq.X',
 * select: '...', limit: '1' }`. Bewust letterlijk, en geen eigen query-taal
 * ertussen: die zou een tweede plek zijn waar een filter kan verdwijnen, en een
 * verdwenen filter levert feiten over de verkeerde order.
 *
 * `organization_id` zetten we er zelf op en niet de bron — dat is geen keuze
 * van een module (harde regel 5).
 */
async function leesTabel(
  db: SupabaseClient,
  env: Env,
  tabel: string,
  params: Record<string, unknown>,
  dataCategories: readonly DataCategory[],
): Promise<FactRunResult> {
  const url = db.tableUrl(tabel);
  for (const [sleutel, waarde] of Object.entries(params)) {
    if (waarde === undefined || waarde === null) continue;
    url.searchParams.set(sleutel, String(waarde));
  }

  const rijen = await db.request<unknown>(
    ctxVoor(env, `db.${tabel}`, dataCategories),
    url,
    { method: 'GET' },
  );
  return { ok: true, data: Array.isArray(rijen) ? rijen : [] };
}

/** De tenant-context van één feitencall. */
function ctxVoor(env: Env, toolCallId: string, dataCategories: readonly DataCategory[]) {
  return {
    organizationId: env.AIOS_ORG_ID,
    agentId: 'aios-agent',
    toolCallId,
    dataCategories: [...dataCategories],
  };
}
