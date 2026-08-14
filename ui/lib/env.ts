/** Params waarmee de cockpit de Execute-Workflow van de agent start. */
export interface ExecuteParams {
  reviewItemId: string;
  /** Stabiele idempotency-key (= reviewItemId) → dubbele approve = no-op. */
  idempotencyKey: string;
}

/**
 * Cloudflare-bindings/secrets voor de cockpit-Worker. Opgehaald via
 * `getCloudflareContext().env` in Server Components / Route Handlers.
 */
export interface CockpitEnv {
  /** Klantnaam voor de cockpit-header; valt terug op `BRAND.name`. */
  CLIENT_NAME?: string;

  /**
   * Demo-modus ("true"). Zet de demo-pagina + `/api/demo` aan, waarmee een
   * beheerder synthetische mail door de echte pipeline kan sturen. Standaard
   * uit — op een productie-cockpit hoort deze var niet gezet te zijn.
   */
  DEMO_MODE?: string;

  /** Klant-Supabase (waar ReviewItem leeft + Supabase Auth draait). */
  AIOS_SUPABASE_URL: string;
  AIOS_SUPABASE_SERVICE_ROLE_KEY: string;

  /** Publieke anon-key van het klant-project — voor de Supabase Auth-client. */
  SUPABASE_ANON_KEY: string;

  /**
   * Org-id die deze cockpit-instance bedient. Sinds Fase 5B verplicht: er
   * kunnen meerdere org-ids (prod + test-tenants) in dezelfde aios-DB
   * staan, dus elke deploy MOET expliciet zeggen welke hij mag zien.
   * Prod-cockpit → cuid van de klant-org. Staging-cockpit → cuid van het
   * child-test-tenant. Wordt afgedwongen in `makeCockpitClient()`.
   */
  AIOS_ORG_ID: string;

  /**
   * Toont of deze cockpit een prod- of staging-deployment is. Alleen
   * `staging` triggert de STAGING-banner. Default (undefined = "prod")
   * gedraagt zich als de bestaande prod-cockpit.
   */
  COCKPIT_MODE?: "prod" | "staging";

  /**
   * Alleen op staging-cockpits: cuid van de klant-org (parent) waar
   * gepromote configuratie heen moet. Wanneer gezet toont de UI een
   * "Push naar prod"-knop naast elke policy-rule. Op prod-cockpit leeg —
   * er is niks om naartoe te promoten.
   */
  AIOS_PARENT_ORG_ID?: string;

  /** Feedback-few-shot aan voor deze tenant ("true"). Vereist VOYAGE_API_KEY. */
  AIOS_RAG_ENABLED?: string;
  /** Voyage AI API-key voor embeddings (feedback-MemoryEntry, voyage-3.5). */
  VOYAGE_API_KEY?: string;
  MODEL_EMBED?: string;

  /** Workflow-binding naar aios-agent → ExecuteWorkflow. */
  EXECUTE: Workflow<ExecuteParams>;
}
