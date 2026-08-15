import {
  SupabaseClient,
  ServiceRoleCredentialStore,
  type TenantContext,
} from '@factumai/agent-core';
import type {
  CompoundTaskSummary,
  GroundingRef,
  PartialResponse,
  PartialResponseStatus,
  PartialToolCall,
  ReviewItem,
  Signal,
  SignalStatus,
  SpecialistId,
} from '@factumai/agent-core';
import { toDecisionLogRow, type DecisionLog } from '@factumai/agent-core';
import type { Env, PlatformStore, UnknownIntentEntry } from './env.js';
import { callMcp, cfAccessHeaders, mcpBearer } from './mcp.js';

/**
 * Platform-DB-toegang voor de Workflows — tegen de klant-Supabase.
 * PostgREST via de gedeelde `SupabaseClient` met de
 * service-role-key (omzeilt RLS). Tabellen: zie `migrations/0001_aios_tables.sql`.
 *
 * Mapt de snake_case DB-kolommen op de camelCase TS-contracten van
 * @factumai/agent-core.
 */

const STORE_CTX: TenantContext = {
  organizationId: '_aios',
  agentId: 'aios-store',
  toolCallId: 'aios-store',
};

interface SignalRow {
  id: string;
  organization_id: string;
  domain: string;
  type: string;
  payload: Record<string, unknown>;
  status: SignalStatus;
  contact_id: string | null;
  deal_id: string | null;
  project_id: string | null;
  idempotency_key: string | null;
  received_at: string;
  processed_at: string | null;
}

interface ReviewItemRow {
  id: string;
  organization_id: string;
  signal_id: string | null;
  kind: string;
  summary: string;
  proposed: Record<string, unknown>;
  confidence: number | null;
  grounding: ReviewItem['grounding'];
  status: ReviewItem['status'];
  decided_at: string | null;
  executed_at: string | null;
  created_at: string;
  // Fase 3 — compound-metadata (migratie 0017).
  compound: boolean | null;
  tasks: CompoundTaskSummary[] | null;
  precedence_intent: string | null;
}

function rowToSignal(r: SignalRow): Signal {
  return {
    id: r.id,
    organizationId: r.organization_id,
    domain: r.domain,
    type: r.type,
    payload: r.payload ?? {},
    status: r.status,
    contactId: r.contact_id,
    dealId: r.deal_id,
    projectId: r.project_id,
    idempotencyKey: r.idempotency_key,
    receivedAt: r.received_at,
    processedAt: r.processed_at,
  };
}

function rowToReviewItem(r: ReviewItemRow): ReviewItem {
  return {
    id: r.id,
    organizationId: r.organization_id,
    signalId: r.signal_id,
    kind: r.kind,
    summary: r.summary,
    proposed: r.proposed ?? {},
    compound: r.compound,
    tasks: r.tasks,
    precedenceIntent: (r.precedence_intent as SpecialistId | null) ?? null,
    confidence: r.confidence,
    grounding: r.grounding ?? null,
    status: r.status,
    decidedAt: r.decided_at,
    executedAt: r.executed_at,
    createdAt: r.created_at,
  };
}

function reviewItemToRow(item: ReviewItem): ReviewItemRow {
  return {
    id: item.id,
    organization_id: item.organizationId,
    signal_id: item.signalId ?? null,
    kind: item.kind,
    summary: item.summary,
    proposed: item.proposed,
    confidence: item.confidence ?? null,
    grounding: item.grounding ?? null,
    status: item.status,
    decided_at: item.decidedAt ?? null,
    executed_at: item.executedAt ?? null,
    created_at: item.createdAt,
    // Compound-metadata: default false / null zodat single-intent
    // ReviewItems (Fase 1/2) niks veranderen aan hun rij-vorm.
    compound: item.compound ?? false,
    tasks: item.tasks ?? null,
    precedence_intent: item.precedenceIntent ?? null,
  };
}

// ---------------------------------------------------------------------------
// aios_partial_responses (Fase 3 fan-in)
// ---------------------------------------------------------------------------

interface PartialResponseRow {
  id: string;
  organization_id: string;
  signal_id: string;
  task_id: string;
  intent: string;
  status: PartialResponseStatus;
  resolved_refs: Record<string, string | null>;
  facts: Record<string, unknown>;
  proposed_content: string;
  confidence: number;
  grounding: GroundingRef[];
  tool_calls: PartialToolCall[] | null;
  reason: string | null;
  created_at: string;
}

function partialToRow(p: PartialResponse, orgId: string): PartialResponseRow {
  return {
    id: `part_${p.signalId}_${p.taskId}`,
    organization_id: orgId,
    signal_id: p.signalId,
    task_id: p.taskId,
    intent: p.intent,
    status: p.status,
    resolved_refs: p.resolvedRefs ?? {},
    facts: p.facts ?? {},
    proposed_content: p.proposedContent,
    confidence: p.confidence,
    grounding: p.grounding ?? [],
    tool_calls: p.toolCalls ?? null,
    reason: p.reason ?? null,
    created_at: p.createdAt,
  };
}

function rowToPartial(r: PartialResponseRow): PartialResponse {
  return {
    signalId: r.signal_id,
    taskId: r.task_id,
    intent: r.intent as SpecialistId,
    status: r.status,
    resolvedRefs: r.resolved_refs ?? {},
    facts: r.facts ?? {},
    proposedContent: r.proposed_content,
    confidence: r.confidence,
    grounding: r.grounding ?? [],
    toolCalls: r.tool_calls ?? undefined,
    reason: r.reason ?? undefined,
    createdAt: r.created_at,
  };
}

export function createPlatformStore(env: Env): PlatformStore {
  const client = new SupabaseClient(
    new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
    { projectUrl: env.AIOS_SUPABASE_URL },
  );

  return {
    async loadSignal(signalId: string): Promise<Signal> {
      const url = client.tableUrl('aios_signals');
      url.searchParams.set('id', `eq.${signalId}`);
      url.searchParams.set('limit', '1');
      const rows = await client.request<SignalRow[]>(STORE_CTX, url, { method: 'GET' });
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) throw new Error(`Signal ${signalId} niet gevonden in de klant-DB`);
      return rowToSignal(row);
    },

    async saveReviewItem(item: ReviewItem): Promise<void> {
      const url = client.tableUrl('aios_review_items');
      await client.request<unknown>(STORE_CTX, url, {
        method: 'POST',
        body: JSON.stringify(reviewItemToRow(item)),
        prefer: 'return=minimal,resolution=merge-duplicates',
      });
    },

    async loadReviewItem(reviewItemId: string): Promise<ReviewItem> {
      const url = client.tableUrl('aios_review_items');
      url.searchParams.set('id', `eq.${reviewItemId}`);
      url.searchParams.set('limit', '1');
      const rows = await client.request<ReviewItemRow[]>(STORE_CTX, url, { method: 'GET' });
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) throw new Error(`ReviewItem ${reviewItemId} niet gevonden in de klant-DB`);
      return rowToReviewItem(row);
    },

    async markSignal(signalId: string, status: SignalStatus): Promise<void> {
      const url = client.tableUrl('aios_signals');
      url.searchParams.set('id', `eq.${signalId}`);
      await client.request<unknown>(STORE_CTX, url, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          processed_at: status === 'DONE' ? new Date().toISOString() : null,
        }),
        prefer: 'return=minimal',
      });
    },

    // ── Fase 3 — compound-fan-in ────────────────────────────────────────
    async savePartialResponse(partial: PartialResponse): Promise<void> {
      const url = client.tableUrl('aios_partial_responses');
      // Org-id komt uit het Signal (die is de tenant-scope-waarheid). Voor
      // Eén deploy = één tenant, dus hier direct AIOS_ORG_ID gebruiken.
      const row = partialToRow(partial, env.AIOS_ORG_ID);
      await client.request<unknown>(STORE_CTX, url, {
        method: 'POST',
        body: JSON.stringify(row),
        // (signal_id, task_id) is UNIQUE — merge-duplicates zorgt dat een
        // dubbele start dezelfde rij overschrijft i.p.v. UNIQUE-violation.
        prefer: 'return=minimal,resolution=merge-duplicates',
      });
    },

    async listPartialResponses(signalId: string): Promise<PartialResponse[]> {
      const url = client.tableUrl('aios_partial_responses');
      url.searchParams.set('signal_id', `eq.${signalId}`);
      url.searchParams.set('order', 'created_at.asc');
      const rows = await client.request<PartialResponseRow[]>(STORE_CTX, url, {
        method: 'GET',
      });
      return Array.isArray(rows) ? rows.map(rowToPartial) : [];
    },

    async countPartialResponses(signalId: string): Promise<number> {
      const url = client.tableUrl('aios_partial_responses');
      url.searchParams.set('signal_id', `eq.${signalId}`);
      url.searchParams.set('select', 'id');
      // PostgREST `Prefer: count=exact` retourneert de count in de
      // `Content-Range`-header. Hier is een gewone GET met alleen id's
      // korter dan een custom RPC — voor onze schaal (max ~10 partials per
      // signaal) is dat prima; upgrade naar HEAD+count kan later.
      const rows = await client.request<Array<{ id: string }>>(STORE_CTX, url, {
        method: 'GET',
      });
      return Array.isArray(rows) ? rows.length : 0;
    },

    /**
     * Schrijft het beslislog. Idempotent op `dl_<signalId>`: een herstartende
     * Workflow-step overschrijft z'n eigen regel in plaats van er een tweede
     * bij te zetten.
     *
     * Best-effort: het beslislog is er om achteraf te kunnen reconstrueren,
     * niet om de afhandeling te blokkeren. Faalt de schrijfactie, dan loggen we
     * dat en gaat de mail gewoon door (CLAUDE.md: fail-soft).
     */
    async saveDecisionLog(log: DecisionLog): Promise<void> {
      try {
        const url = client.tableUrl('aios_decision_logs');
        await client.request<unknown>(STORE_CTX, url, {
          method: 'POST',
          body: JSON.stringify({
            ...toDecisionLogRow(log, `dl_${log.signalId}`),
            organization_id: env.AIOS_ORG_ID,
          }),
          prefer: 'return=minimal,resolution=merge-duplicates',
        });
      } catch (err) {
        console.warn(
          '[decision-log] schrijven mislukt:',
          err instanceof Error ? err.message : String(err),
        );
      }
    },

    async saveUnknownIntent(entry: UnknownIntentEntry): Promise<void> {
      const url = client.tableUrl('aios_unknown_intent_log');
      await client.request<unknown>(STORE_CTX, url, {
        method: 'POST',
        body: JSON.stringify({
          id: entry.id,
          organization_id: env.AIOS_ORG_ID,
          signal_id: entry.signalId,
          router_reasoning: entry.routerReasoning,
          router_top_candidates: entry.routerTopCandidates,
          mail_summary: entry.mailSummary,
          // mail_embedding blijft null — geen embedding-generatie hier;
          // clustering-fase kan later batch-embeddings maken.
        }),
        // Router-retry mag geen UNIQUE-violation opleveren; id = unk_{signalId}.
        prefer: 'return=minimal,resolution=merge-duplicates',
      });
    },
  };
}
