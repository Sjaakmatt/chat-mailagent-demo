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

  /**
   * De afdelingen die deze klant heeft afgenomen, komma-gescheiden. Bijvoorbeeld
   * `"klantenservice"` of `"klantenservice,sales"`.
   *
   * Dit is de commerciële grens: wij verkopen per afdeling. Hij staat hier en
   * niet in de klant-database, omdat de klant-database in het Supabase-project
   * van de klant leeft — een plafond dat de begrensde partij zelf kan verzetten
   * is geen plafond. Deze var wordt bij het deployen gezet, niet in de cockpit.
   *
   * Ontbreekt hij, dan is er niets afgenomen en ziet niemand iets. Bewust
   * fail-closed en anders dan bij de rollen: een ontbrekende afname is geen
   * storing die je wilt overbruggen.
   *
   * `"*"` betekent "het hele aanbod" en hoort alleen op onze eigen tenants en
   * demo-omgevingen te staan.
   *
   * Hoort per tenant in het control plane zodra dat er is.
   */
  LICENSED_MODULES?: string;

  /** Feedback-few-shot aan voor deze tenant ("true"). Vereist VOYAGE_API_KEY. */
  AIOS_RAG_ENABLED?: string;
  /** Voyage AI API-key voor embeddings (feedback-MemoryEntry, voyage-3.5). */
  VOYAGE_API_KEY?: string;
  MODEL_EMBED?: string;

  /**
   * Werkbak-assistent, laag 1 (dossier). Alleen de letterlijke waarde "true"
   * zet 'm aan. Bewust opt-in: een assistent die er zomaar staat bij een klant
   * die 'm niet heeft gekocht, is een verrassing — en hij kost per vraag geld.
   *
   * Hoort per tenant in het control plane; hier als var tot dat er is. De
   * analyse-laag (laag 2) krijgt een eigen vlag mét voorwaardencontrole.
   */
  ASSISTANT_DOSSIER?: string;

  /**
   * Werkbak-assistent, laag 2 (analyse). Alleen de letterlijke waarde "true".
   *
   * De vlag beslist niet alleen: de drie voorwaarden uit de bouwbriefing worden
   * gecontroleerd, niet vertrouwd. Voldoet er iets niet, dan blijft de laag uit
   * mét de reden. Zie `ui/lib/assistant/analyse.ts` en de Toegang-pagina.
   */
  ASSISTANT_ANALYSE?: string;

  /**
   * Domein waaronder de MCP-subdomeinen hangen; default `factumai.nl`. Elke MCP
   * heeft een eigen custom domain: `https://mcp-tickets.factumai.nl/mcp`.
   *
   * De cockpit leidt de URL dus af uit de MCP-naam en heeft standaard geen
   * configuratie nodig. Zie `ui/lib/assistant/mcp-endpoints.ts`.
   */
  MCP_DOMAIN?: string;

  /**
   * Overrides per MCP — dezelfde vars die de agent-Worker gebruikt. Winnen van
   * de afleiding, voor een MCP die tijdelijk ergens anders draait of een lokale
   * tunnel tijdens ontwikkelen.
   */
  FACTUMAI_MCP_TICKETS_URL?: string;
  FACTUMAI_MCP_ERP_URL?: string;
  FACTUMAI_MCP_MAIL_URL?: string;
  FACTUMAI_MCP_CRM_URL?: string;
  /** Inbound-secret voor de MCP's; zonder dit is elke /mcp-request 401. */
  FACTUMAI_MCP_INBOUND_SECRET?: string;
  FACTUMAI_MCP_API_KEY?: string;
  /** Cloudflare Access service-token voor MCP's achter een custom domain. */
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

  /** Anthropic-key voor de assistent. Zonder key blijft de assistent uit. */
  ANTHROPIC_API_KEY?: string;

  /**
   * Model voor de assistent. Uit config, nooit hardcoded (harde regel 7). Het
   * dossier is redeneerwerk over aangeleverde tekst → Sonnet-tier.
   */
  MODEL_ASSISTANT?: string;

  /** Workflow-binding naar aios-agent → ExecuteWorkflow. */
  EXECUTE: Workflow<ExecuteParams>;
  /**
   * Workflow-binding naar aios-agent → ActionExecuteWorkflow.
   *
   * Het schrijven zelf hoort daar en niet hier: harde regel 3. Deze route
   * beslist of het mag; de Workflow doet het, idempotent en met een tweede
   * hervalidatie vlak vóór de schrijfactie.
   */
  ACTION_EXECUTE: Workflow<{
    actionId: string;
    approverRole: 'viewer' | 'reviewer' | 'admin';
    approvedBy: string;
  }>;
}
