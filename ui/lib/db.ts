import type { TenantContext } from "@factumai/agent-core";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { CockpitEnv } from "./env";
import { CockpitDbClient, makeCockpitClient } from "./tenant-query";
import type { ReviewItemRow, ReviewStatus } from "./review";
import {
  fromDecisionLogRow,
  kindsHandledOutsideWorkbench,
  type DecisionLog,
  type DecisionLogRow,
} from "@factumai/agent-core";
import {
  domainAuditSources,
  selectedDomainSources,
  type DomainAuditSource,
} from "./audit-sources";

/**
 * Cockpit-DB-toegang tegen de klant-Supabase (PostgREST, service-role).
 * Alleen wat de werkbak nodig heeft: ReviewItems tonen en de beslissing
 * (APPROVED/EDITED/REJECTED) wegschrijven. De verzending gebeurt in de
 * Execute-Workflow van de agent, niet hier (Build Document B2).
 *
 * Sinds Fase 5B tenant-gescoped: elke `tableUrl(...)` filtert automatisch
 * op `organization_id=eq.<AIOS_ORG_ID>` via `CockpitDbClient`. Voorheen
 * één DB = één tenant; nu kan er mixed test-tenant data in staan.
 */

/**
 * Backwards-compat: `CTX` was een placeholder ("_aios") die vóór 5B in
 * elke request-call werd meegegeven. Nieuwe code gebruikt `client.ctx()`;
 * blijft hier als re-export zodat bestaande callers niet breken, maar
 * `CockpitDbClient.request()` negeert 'm en gebruikt z'n eigen scoped ctx.
 */
export const CTX: TenantContext = {
  organizationId: "_aios",
  agentId: "aios-cockpit",
  toolCallId: "aios-cockpit",
};

/** Haal de Cloudflare-env op (Server Component / Route Handler only). */
export function cockpitEnv(): CockpitEnv {
  const { env } = getCloudflareContext();
  return env as unknown as CockpitEnv;
}

/**
 * Maakt een tenant-scoped cockpit-client. Faalt luid als AIOS_ORG_ID
 * ontbreekt op de Worker-config (zie `tenant-query.ts`).
 */
export function makeClient(env: CockpitEnv): CockpitDbClient {
  return makeCockpitClient(env);
}

/**
 * ReviewItems voor de werkbak: PENDING + recent besliste (laatste 7 dagen).
 *
 * Minus de soorten van kanalen die hun werk elders afhandelen — vandaag alleen
 * chat. De werkbak is de plek waar een mens beslist; bij chat is er niets meer
 * te beslissen tegen de tijd dat het item hier zou staan. Dat gesprek staat
 * onder Gesprekken en het uitzoekwerk onder Tickets, en een derde kopie in de
 * wachtrij maakt van die drie schermen één hoop.
 *
 * De uitsluiting komt uit de kanaal-registry in agent-core en staat niet hier:
 * de cockpit is de schil en hoort `draft_chat_reply` niet bij naam te kennen.
 * Zie `kindsHandledOutsideWorkbench()`.
 */
export async function listReviewItems(
  client: CockpitDbClient,
): Promise<ReviewItemRow[]> {
  const url = client.tableUrl("aios_review_items");
  const buiten = kindsHandledOutsideWorkbench();
  // Server-side wegfilteren, niet ná het ophalen: anders vult chat de limiet van
  // 200 met items die toch niet getoond worden en verdwijnt echt reviewwerk
  // onderaan uit beeld.
  if (buiten.length > 0) {
    url.searchParams.set("kind", `not.in.(${buiten.join(",")})`);
  }
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "200");
  const rows = await client.request<ReviewItemRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows : [];
}

/** Compacte rij voor analytics/audit — scalairen + categorie (uit proposed). */
export interface ReviewMetricRow {
  id: string;
  status: ReviewStatus;
  kind: string;
  summary: string;
  confidence: number | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
  decided_by: string | null;
  category: string | null;
  /** Welke automatisering dit item maakte. Null bij items van vóór 0030. */
  module: string | null;
}

/**
 * Lichte fetch voor analytics + auditlog: alleen scalairen + de categorie uit
 * proposed.classification (geen volledige proposed-body). Voor de huidige
 * test-schaal volstaat in-JS aggregeren; bij groei → een SQL-view/RPC.
 */
export async function listReviewRows(
  client: CockpitDbClient,
  limit = 1000,
): Promise<ReviewMetricRow[]> {
  const url = client.tableUrl("aios_review_items");
  url.searchParams.set(
    "select",
    "id,status,kind,summary,confidence,created_at,decided_at,executed_at,decided_by,module,category:proposed->classification->>category",
  );
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(limit));
  const rows = await client.request<ReviewMetricRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows : [];
}

/** Server-side filters + paginering voor de auditlog (onbegrensd). */
export interface AuditQuery {
  status?: string; // APPROVED | EDITED | EXECUTED | REJECTED | CLAIMED | SHIPPED | CANCELLED
  q?: string;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd
  /** Exacte e-mail (decided_by/claimed_by/completed_by). */
  decidedBy?: string;
  /** Classificatie-slug uit de taxonomie (bv. "retour_ruilen"). */
  category?: string;
  /**
   * Bron: "review" (mail-beslissingen), "all" (default), of de `id` van een
   * geregistreerde domein-auditbron (zie `audit-sources.ts`).
   */
  source?: "review" | "all" | (string & {});
  page?: number; // 0-based
  pageSize?: number; // default 50
}

/**
 * Eén regel in de gemeenschappelijke auditlog. Verenigt mail-beslissingen
 * (review-items) met de events van eventuele domeinmodules, zodat alles op één
 * chronologische tijdlijn vindbaar is.
 */
export interface AuditEntry {
  /** Stabiele id voor React-keys. */
  key: string;
  /** "review" of de `id` van een geregistreerde domein-auditbron. */
  source: "review" | (string & {});
  /** Actie: APPROVED/EDITED/EXECUTED/REJECTED, of een domein-eigen actie. */
  action: string;
  /** Wie de actie deed. */
  by: string | null;
  /** Wanneer (ISO). */
  at: string;
  /** Eén-regel omschrijving (kop). */
  summary: string;
  /** Voor review: order/categorie. Domeinbronnen vullen hun eigen context. */
  meta: string | null;
  /** Linkbaar naar mail-detail; domein-events verwijzen naar hun bron-item. */
  reviewItemId?: string | null;
  /** Id van het domein-record achter dit event (bv. een werkticket). */
  domainRef?: string | null;
  /** Vrij label bij het domein-record (bv. een verzendlabel). */
  domainLabel?: string | null;
}

export interface AuditPage {
  rows: ReviewMetricRow[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

const AUDIT_SELECT =
  "id,status,kind,summary,confidence,created_at,decided_at,executed_at,decided_by,category:proposed->classification->>category";

function applyAuditFilters(url: URL, q: AuditQuery): void {
  // Alleen besliste items (geen PENDING). Specifieke status filtert verder.
  if (q.status) url.searchParams.set("status", `eq.${q.status}`);
  else url.searchParams.set("status", "neq.PENDING");
  if (q.from) url.searchParams.append("created_at", `gte.${q.from}`);
  if (q.to) url.searchParams.append("created_at", `lte.${q.to}T23:59:59`);
  if (q.decidedBy) {
    url.searchParams.set("decided_by", `eq.${q.decidedBy.toLowerCase()}`);
  }
  if (q.category) {
    // Filter op de geneste JSON-key proposed.classification.category.
    url.searchParams.set(
      "proposed->classification->>category",
      `eq.${q.category}`,
    );
  }
  if (q.q) {
    // Sanitize: komma's/haakjes/sterren breken de PostgREST or-syntax.
    const safe = q.q.replace(/[,()*]/g, " ").trim();
    if (safe) {
      url.searchParams.set(
        "or",
        `(summary.ilike.*${safe}*,decided_by.ilike.*${safe}*)`,
      );
    }
  }
}

/** Eén pagina auditrijen (review-only — legacy). Wordt vervangen door listAuditEntriesPage. */
export async function listAuditPage(
  client: CockpitDbClient,
  query: AuditQuery,
): Promise<AuditPage> {
  const pageSize = query.pageSize ?? 50;
  const page = Math.max(0, query.page ?? 0);
  const url = client.tableUrl("aios_review_items");
  url.searchParams.set("select", AUDIT_SELECT);
  url.searchParams.set("order", "created_at.desc");
  applyAuditFilters(url, query);
  url.searchParams.set("limit", String(pageSize + 1));
  url.searchParams.set("offset", String(page * pageSize));
  const rows = await client.request<ReviewMetricRow[]>(CTX, url, {
    method: "GET",
  });
  const arr = Array.isArray(rows) ? rows : [];
  return { rows: arr.slice(0, pageSize), page, pageSize, hasNext: arr.length > pageSize };
}

// ---------------------------------------------------------------------------
// Verenigde auditlog (reviews + domeinbronnen) — voor de Auditlog-pagina.
// ---------------------------------------------------------------------------

/** Acties die de kern (review-beslissingen) kan produceren. */
const REVIEW_ACTIONS = ["APPROVED", "EDITED", "EXECUTED", "REJECTED"];

function reviewRowToEntry(r: ReviewMetricRow): AuditEntry {
  return {
    key: `rev-${r.id}-${r.status}`,
    source: "review",
    action: r.status,
    by: r.decided_by,
    at: r.decided_at ?? r.created_at,
    summary: r.summary,
    meta: r.category,
    reviewItemId: r.id,
  };
}

/**
 * Verenigde auditlog: mail-beslissingen + de events van geregistreerde
 * domeinbronnen, chronologisch, nieuwste eerst. Filters worden op elke bron
 * toegepast voor zover van toepassing. Pagineert over de samengevoegde lijst
 * zodat een domein-event gewoon op z'n plek tussen de mail-events verschijnt.
 *
 * Bewust over-fetchen + in-JS slicen: voor onze schaal (honderden per dag)
 * makkelijker dan een cross-tabel cursor; bij groei → een view of RPC.
 */
export async function listAuditEntriesPage(
  client: CockpitDbClient,
  query: AuditQuery,
): Promise<{
  entries: AuditEntry[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}> {
  const pageSize = query.pageSize ?? 50;
  const page = Math.max(0, query.page ?? 0);
  const source = query.source ?? "all";
  const wantReview = source === "review" || source === "all";

  // Per bron tot 500 rijen — ruim genoeg voor een paginering tot ~10 pagina's.
  const FETCH_CAP = 500;

  const [reviewEntries, ...domainEntries] = await Promise.all([
    wantReview
      ? fetchReviewEntries(client, query, FETCH_CAP)
      : Promise.resolve<AuditEntry[]>([]),
    ...selectedDomainSources(source).map((src) =>
      fetchDomainEntries(src, client, query, FETCH_CAP),
    ),
  ]);

  // Statusfilter dat ook domein-acties raakt — server-side hebben we 'm alleen
  // op reviews kunnen toepassen; voor domeinbronnen hier nogmaals.
  const statusOk = (e: AuditEntry): boolean => {
    if (!query.status) return true;
    return e.action === query.status;
  };
  // Vrij zoeken (q) over summary + by + meta.
  const qNeedle = (query.q ?? "").trim().toLowerCase();
  const qOk = (e: AuditEntry): boolean => {
    if (!qNeedle) return true;
    return (
      e.summary.toLowerCase().includes(qNeedle) ||
      (e.by ?? "").toLowerCase().includes(qNeedle) ||
      (e.meta ?? "").toLowerCase().includes(qNeedle)
    );
  };

  const merged = [...reviewEntries, ...domainEntries.flat()]
    .filter((e) => statusOk(e) && qOk(e))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const start = page * pageSize;
  const slice = merged.slice(start, start + pageSize);
  const hasNext = merged.length > start + pageSize;
  return { entries: slice, page, pageSize, hasNext };
}

/** Volledige (geünificeerde) auditlog voor CSV-export — hoge cap. */
export async function listAuditEntriesForExport(
  client: CockpitDbClient,
  query: AuditQuery,
  cap = 5000,
): Promise<AuditEntry[]> {
  const source = query.source ?? "all";
  const wantReview = source === "review" || source === "all";
  const [reviewEntries, ...domainEntries] = await Promise.all([
    wantReview ? fetchReviewEntries(client, query, cap) : Promise.resolve<AuditEntry[]>([]),
    ...selectedDomainSources(source).map((src) =>
      fetchDomainEntries(src, client, query, cap),
    ),
  ]);
  const qNeedle = (query.q ?? "").trim().toLowerCase();
  return [...reviewEntries, ...domainEntries.flat()]
    .filter((e) => (!query.status || e.action === query.status))
    .filter((e) => {
      if (!qNeedle) return true;
      return (
        e.summary.toLowerCase().includes(qNeedle) ||
        (e.by ?? "").toLowerCase().includes(qNeedle) ||
        (e.meta ?? "").toLowerCase().includes(qNeedle)
      );
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, cap);
}

async function fetchReviewEntries(
  client: CockpitDbClient,
  q: AuditQuery,
  cap: number,
): Promise<AuditEntry[]> {
  // Een domein-eigen status (bv. 'SHIPPED') filtert per definitie reviews weg.
  if (q.status && !REVIEW_ACTIONS.includes(q.status)) {
    return [];
  }
  const url = client.tableUrl("aios_review_items");
  url.searchParams.set("select", AUDIT_SELECT);
  url.searchParams.set("order", "created_at.desc");
  applyAuditFilters(url, q);
  url.searchParams.set("limit", String(cap));
  const rows = await client.request<ReviewMetricRow[]>(CTX, url, { method: "GET" });
  return (Array.isArray(rows) ? rows : []).map(reviewRowToEntry);
}

/**
 * Haalt de events van één domeinbron op, fail-soft: een kapotte of nog niet
 * gemigreerde domeinmodule mag de auditlog nooit blank slaan.
 */
async function fetchDomainEntries(
  src: DomainAuditSource,
  client: CockpitDbClient,
  q: AuditQuery,
  cap: number,
): Promise<AuditEntry[]> {
  // Filtert de gevraagde status deze bron per definitie weg? Dan niet ophalen.
  if (q.status && !src.actions.includes(q.status)) return [];
  try {
    return await src.fetch(client, q, cap);
  } catch {
    return [];
  }
}

/**
 * Unieke actor-adressen + categorie-slugs voor de auditlog-dropdowns. Verzamelt
 * `decided_by` uit de reviews plus de actoren die geregistreerde domeinbronnen
 * aandragen, zodat de dropdown álle mensen toont die ergens in de keten een
 * actie hebben gedaan.
 */
export async function listAuditFacets(
  client: CockpitDbClient,
): Promise<{ decidedBy: string[]; categories: string[] }> {
  const [reviews, ...domainActors] = await Promise.all([
    (async () => {
      const url = client.tableUrl("aios_review_items");
      url.searchParams.set(
        "select",
        "decided_by,category:proposed->classification->>category",
      );
      url.searchParams.set("status", "neq.PENDING");
      url.searchParams.set("limit", "1000");
      return (
        await client.request<
          Array<{ decided_by: string | null; category: string | null }>
        >(CTX, url, { method: "GET" })
      ) ?? [];
    })(),
    ...domainAuditSources().map(async (src) => {
      if (!src.actors) return [] as string[];
      try {
        return await src.actors(client);
      } catch {
        return [] as string[];
      }
    }),
  ]);

  const reviewArr = Array.isArray(reviews) ? reviews : [];
  const actors = new Set<string>();
  for (const r of reviewArr) if (r.decided_by) actors.add(r.decided_by);
  for (const a of domainActors.flat()) if (a) actors.add(a);
  const decidedBy = [...actors].sort();
  const categories = [
    ...new Set(reviewArr.map((r) => r.category).filter((v): v is string => !!v)),
  ].sort();
  return { decidedBy, categories };
}

/** Alle matchende auditrijen voor export (hoge cap). */
export async function listAuditForExport(
  client: CockpitDbClient,
  query: AuditQuery,
  cap = 5000,
): Promise<ReviewMetricRow[]> {
  const url = client.tableUrl("aios_review_items");
  url.searchParams.set("select", AUDIT_SELECT);
  url.searchParams.set("order", "created_at.desc");
  applyAuditFilters(url, query);
  url.searchParams.set("limit", String(cap));
  const rows = await client.request<ReviewMetricRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Beslislog bij een ReviewItem. Fail-soft: items van vóór de invoering van het
 * beslislog hebben er geen, en dat mag het detailscherm niet breken.
 */
export async function getDecisionLog(
  client: CockpitDbClient,
  reviewItemId: string,
): Promise<DecisionLog | null> {
  try {
    const url = client.tableUrl("aios_decision_logs");
    url.searchParams.set("review_item_id", `eq.${reviewItemId}`);
    url.searchParams.set("limit", "1");
    const rows = await client.request<DecisionLogRow[]>(CTX, url, { method: "GET" });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return row ? fromDecisionLogRow(row) : null;
  } catch {
    return null;
  }
}

export async function getReviewItem(
  client: CockpitDbClient,
  id: string,
): Promise<ReviewItemRow | undefined> {
  const url = client.tableUrl("aios_review_items");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");
  const rows = await client.request<ReviewItemRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows[0] : undefined;
}

/** Schrijft de beslissing weg; optioneel een aangepaste `proposed` (bij edit). */
export async function decideReviewItem(
  client: CockpitDbClient,
  id: string,
  status: Extract<ReviewStatus, "APPROVED" | "EDITED" | "REJECTED">,
  proposed?: Record<string, unknown>,
  decidedBy?: string,
): Promise<void> {
  const url = client.tableUrl("aios_review_items");
  url.searchParams.set("id", `eq.${id}`);
  const body: Record<string, unknown> = {
    status,
    decided_at: new Date().toISOString(),
  };
  if (proposed) body.proposed = proposed;
  if (decidedBy) body.decided_by = decidedBy;
  await client.request<unknown>(CTX, url, {
    method: "PATCH",
    body: JSON.stringify(body),
    prefer: "return=minimal",
  });
}

// ---------------------------------------------------------------------------
// Edit-historie (aios_review_edits) — audit-trail wie wat wanneer aanpaste.
// ---------------------------------------------------------------------------

export interface ReviewEditRow {
  id: string;
  review_item_id: string;
  edited_by: string;
  edited_at: string;
  subject: string | null;
  body: string | null;
  source: "manual_save" | "decision";
}

/** Voegt een snapshot toe aan de edit-historie van een ReviewItem. */
export async function insertReviewEdit(
  client: CockpitDbClient,
  input: {
    reviewItemId: string;
    editedBy: string;
    subject?: string | null;
    body?: string | null;
    source?: "manual_save" | "decision";
  },
): Promise<void> {
  // `aios_review_edits` heeft geen `organization_id`-kolom — tenant loopt
  // impliciet via `review_item_id` (dat wél org-scoped is). Wrapper laten
  // filteren zou een 400 geven (kolom bestaat niet). `tableUrlNoTenant`
  // signaleert bewust dat we hier op de FK-relatie vertrouwen.
  const url = client.tableUrlNoTenant("aios_review_edits");
  await client.request<unknown>(CTX, url, {
    method: "POST",
    body: JSON.stringify({
      review_item_id: input.reviewItemId,
      edited_by: input.editedBy,
      subject: input.subject ?? null,
      body: input.body ?? null,
      source: input.source ?? "manual_save",
    }),
    prefer: "return=minimal",
  });
}

/** Alle edits voor een review-item, chronologisch oudste-eerst. */
export async function listReviewEdits(
  client: CockpitDbClient,
  reviewItemId: string,
): Promise<ReviewEditRow[]> {
  // Zie insertReviewEdit — tenant-scoping via review_item_id.
  const url = client.tableUrlNoTenant("aios_review_edits");
  url.searchParams.set("review_item_id", `eq.${reviewItemId}`);
  url.searchParams.set("order", "edited_at.asc");
  url.searchParams.set("limit", "200");
  const rows = await client.request<ReviewEditRow[]>(CTX, url, { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

// ---------------------------------------------------------------------------
// Beleidsregels (cockpit-policy)
// ---------------------------------------------------------------------------

export type PolicyAction =
  | "auto_send"
  | "review_queue"
  | "escalate"
  | "no_reply";

export interface PolicyRuleRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  applies_to: string[];
  response_directive: string;
  priority: number;
  enabled: boolean;
  action: string;
  creates_task: boolean;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export async function listPolicyRules(
  client: CockpitDbClient,
): Promise<PolicyRuleRow[]> {
  const url = client.tableUrl("aios_policy_rules");
  url.searchParams.set("order", "priority.asc");
  url.searchParams.set("limit", "500");
  const rows = await client.request<PolicyRuleRow[]>(CTX, url, { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

/** Velden die de editor mag schrijven. */
export interface PolicyRuleInput {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  appliesTo: string[];
  responseDirective: string;
  priority: number;
  enabled: boolean;
  action: string;
  createsTask: boolean;
  updatedBy?: string | null;
}

/** Upsert (create of update) van een beleidsregel. */
export async function upsertPolicyRule(
  client: CockpitDbClient,
  rule: PolicyRuleInput,
): Promise<void> {
  const url = client.tableUrl("aios_policy_rules");
  await client.request<unknown>(CTX, url, {
    method: "POST",
    body: JSON.stringify({
      id: rule.id,
      organization_id: rule.organizationId,
      name: rule.name,
      description: rule.description ?? null,
      applies_to: rule.appliesTo,
      response_directive: rule.responseDirective,
      priority: rule.priority,
      enabled: rule.enabled,
      action: rule.action,
      creates_task: rule.createsTask,
      updated_by: rule.updatedBy ?? null,
      updated_at: new Date().toISOString(),
    }),
    prefer: "return=minimal,resolution=merge-duplicates",
  });
}

export async function deletePolicyRule(
  client: CockpitDbClient,
  id: string,
): Promise<void> {
  const url = client.tableUrl("aios_policy_rules");
  url.searchParams.set("id", `eq.${id}`);
  await client.request<unknown>(CTX, url, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

// ---------------------------------------------------------------------------
// Cross-tenant promote (Fase 5C)
// ---------------------------------------------------------------------------
//
// De staging-cockpit kan een policy-rule kopiëren naar de parent-org (ET → PR).
// Dit is de enige plek waar de cockpit bewust buiten z'n tenant-scope schrijft
// — we gebruiken `tableUrlNoTenant` en zetten `organization_id=eq.<parentOrgId>`
// EXPLICIET in de URL/body. Naam-match tegen bestaande parent-rule bepaalt of
// het een INSERT of UPDATE wordt.

/**
 * Kopieert een policy-rule van de huidige tenant (child) naar de parent-org.
 * De rule wordt gematcht op `name`: als de parent al een rule met die naam
 * heeft wordt die overschreven (met behoud van id + created_at + priority
 * kan de parent-rule z'n eigen prioriteit houden — bewust, want prioriteit
 * kan bewust anders zijn in prod). Als de parent nog geen rule met die naam
 * heeft, wordt er een nieuwe rij aangemaakt met een nieuwe id.
 *
 * Retourneert de effectieve actie voor auditing/logging.
 */
export async function promotePolicyRule(
  client: CockpitDbClient,
  input: {
    childRuleId: string;
    parentOrgId: string;
    promotedBy: string;
  },
): Promise<{ action: "created" | "updated"; parentRuleId: string }> {
  // 1. Fetch het child-rule (via wrapper — impliciet filter op child-org).
  const childUrl = client.tableUrl("aios_policy_rules");
  childUrl.searchParams.set("id", `eq.${input.childRuleId}`);
  childUrl.searchParams.set("limit", "1");
  const childRows = await client.request<PolicyRuleRow[]>(CTX, childUrl, {
    method: "GET",
  });
  const child = Array.isArray(childRows) ? childRows[0] : undefined;
  if (!child) {
    throw new Error(`Child rule ${input.childRuleId} niet gevonden`);
  }

  // 2. Kijk of parent al een rule met dezelfde naam heeft (unscoped write-pad
  //    — expliciet parent-org-id in de query zetten).
  const lookupUrl = client.tableUrlNoTenant("aios_policy_rules");
  lookupUrl.searchParams.set("organization_id", `eq.${input.parentOrgId}`);
  lookupUrl.searchParams.set("name", `eq.${child.name}`);
  lookupUrl.searchParams.set("limit", "1");
  const parentRows = await client.request<PolicyRuleRow[]>(CTX, lookupUrl, {
    method: "GET",
  });
  const existing = Array.isArray(parentRows) ? parentRows[0] : undefined;

  const now = new Date().toISOString();
  const promotedFields = {
    name: child.name,
    description: child.description,
    applies_to: child.applies_to,
    response_directive: child.response_directive,
    // Priority MEEnemen — de kern van de promote is "gedrag zoals in test".
    // Als de reviewer bewust een andere prod-priority wil, doet-ie dat na
    // de promote.
    priority: child.priority,
    enabled: child.enabled,
    action: child.action,
    creates_task: child.creates_task,
    updated_by: input.promotedBy,
    updated_at: now,
  };

  if (existing) {
    // UPDATE bestaande parent-rule. id blijft, created_at blijft.
    const patchUrl = client.tableUrlNoTenant("aios_policy_rules");
    patchUrl.searchParams.set("id", `eq.${existing.id}`);
    // Defense-in-depth: nooit een rule uit een ANDERE org overschrijven,
    // ook al zit de query-URL al goed. Dubbele filter op org-id.
    patchUrl.searchParams.set("organization_id", `eq.${input.parentOrgId}`);
    await client.request<unknown>(CTX, patchUrl, {
      method: "PATCH",
      body: JSON.stringify(promotedFields),
      prefer: "return=minimal",
    });
    return { action: "updated", parentRuleId: existing.id };
  }

  // INSERT nieuwe parent-rule met een verse id.
  const newParentId = `rule_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const insertUrl = client.tableUrlNoTenant("aios_policy_rules");
  await client.request<unknown>(CTX, insertUrl, {
    method: "POST",
    body: JSON.stringify({
      id: newParentId,
      organization_id: input.parentOrgId,
      created_at: now,
      ...promotedFields,
    }),
    prefer: "return=minimal",
  });
  return { action: "created", parentRuleId: newParentId };
}
