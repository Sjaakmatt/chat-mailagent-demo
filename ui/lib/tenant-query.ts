import {
  SupabaseClient,
  ServiceRoleCredentialStore,
  type TenantContext,
  type SupabaseRequestInit,
} from "@factumai/agent-core";
import type { CockpitEnv } from "./env";

/**
 * Verplichte tenant-wrapper voor élke aios-DB-query in de cockpit. Sinds de
 * introductie van test-tenants (Fase 5A) staat er mixed-tenant data in de
 * aios-DB — één per klant-org én één per test-child. Zonder filter zou de
 * prod-cockpit test-rijen tonen (en vice versa).
 *
 * Deze wrapper zet automatisch `organization_id=eq.<AIOS_ORG_ID>` op
 * elke tabel-URL zodat je 'm niet kan vergeten. `insertRow()` prependt de
 * org-id aan het INSERT-body. `rpcUrl()`/`request()`-passthroughs zijn er
 * voor edge-cases (RPC's die zelf tenant-context nemen).
 *
 * Callers krijgen dezelfde methode-shape als `SupabaseClient` — bestaande
 * code die `client.tableUrl(...)`, `client.request(...)` etc. gebruikt
 * werkt onveranderd zolang de client uit `makeCockpitClient()` komt.
 */
export class CockpitDbClient {
  constructor(
    private readonly inner: SupabaseClient,
    public readonly orgId: string,
  ) {}

  /** `<projectUrl>/rest/v1/<table>?organization_id=eq.<orgId>` — filter altijd meebakt. */
  tableUrl(table: string): URL {
    const url = this.inner.tableUrl(table);
    url.searchParams.set("organization_id", `eq.${this.orgId}`);
    return url;
  }

  /**
   * Rauwe tabel-URL zónder tenant-filter. Enige legitieme use-case: tabellen
   * die géén `organization_id`-kolom hebben omdat hun tenant-relatie
   * impliciet via een FK loopt (bv. `aios_review_edits.review_item_id →
   * aios_review_items.organization_id`). De aanroeper is verantwoordelijk
   * voor tenant-isolatie via een expliciete parent-FK-filter.
   *
   * Bewust een aparte, opvallende naam zodat een grep op `.tableUrlNoTenant(`
   * alle "vertrouw-mij"-plekken direct zichtbaar maakt tijdens review.
   */
  tableUrlNoTenant(table: string): URL {
    return this.inner.tableUrl(table);
  }

  /** RPC-URL — RPC's krijgen tenant via hun params, niet via query-string. */
  rpcUrl(fn: string): URL {
    return this.inner.rpcUrl(fn);
  }

  /**
   * PostgREST-request. Drop-in compat met `SupabaseClient.request(ctx, url, init)`
   * — de meegegeven ctx wordt genegeerd en vervangen door onze eigen
   * tenant-scoped ctx. Vóór 5B was ctx een placeholder ("_aios"), dus
   * ignoring 'm breekt niks; callers hoeven niet aangepast te worden.
   */
  async request<T>(
    _ctx: TenantContext,
    url: URL,
    init: SupabaseRequestInit,
  ): Promise<T> {
    return this.inner.request<T>(this.ctx(), url, init);
  }

  ctx(): TenantContext {
    return {
      organizationId: this.orgId,
      agentId: "aios-cockpit",
      toolCallId: "aios-cockpit",
    };
  }
}

/**
 * Bouwt een tenant-scoped SupabaseClient voor de cockpit. Faalt luid als
 * `AIOS_ORG_ID` ontbreekt — sinds Fase 5B is die verplicht (geen
 * default naar prod-org, anders zou een verkeerd geconfigureerde
 * staging-Worker stilletjes prod-data laten zien).
 */
export function makeCockpitClient(env: CockpitEnv): CockpitDbClient {
  if (!env.AIOS_ORG_ID) {
    throw new Error(
      "AIOS_ORG_ID is required — every cockpit deployment must be tenant-scoped",
    );
  }
  const inner = new SupabaseClient(
    new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
    { projectUrl: env.AIOS_SUPABASE_URL },
  );
  return new CockpitDbClient(inner, env.AIOS_ORG_ID);
}
