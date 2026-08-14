/**
 * AIOS-memory-helpers (Build Document A8): schrijven naar + ophalen uit
 * `aios_memory_entries` met pgvector-similarity. App/Workflow-laag, niet een MCP.
 * Tenant-scoped op organization_id. Embeddings worden als vector-literal
 * doorgegeven (PostgREST → text → `::vector` in de RPC/insert).
 */

import { SupabaseClient } from '../supabase/index.js';
import type { TenantContext } from '../tenant/index.js';
import type { MemoryScope, MemoryLabel } from '../contracts/index.js';

/** pgvector text-literal: `[0.1,0.2,...]`. */
export function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export interface MemoryInsert {
  id?: string;
  organizationId: string;
  scope: MemoryScope;
  pinned?: boolean;
  title: string;
  body: string;
  embedding: number[];
  source: string;
  sourceRef?: string | null;
  label?: MemoryLabel | null;
  supersededDraft?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  projectId?: string | null;
}

export async function insertMemoryEntry(
  client: SupabaseClient,
  ctx: TenantContext,
  m: MemoryInsert,
): Promise<void> {
  const row = {
    id: m.id ?? `mem_${crypto.randomUUID().replace(/-/g, '')}`,
    organization_id: m.organizationId,
    scope: m.scope,
    pinned: m.pinned ?? false,
    title: m.title,
    body: m.body,
    embedding: vectorLiteral(m.embedding),
    source: m.source,
    source_ref: m.sourceRef ?? null,
    label: m.label ?? null,
    superseded_draft: m.supersededDraft ?? null,
    contact_id: m.contactId ?? null,
    deal_id: m.dealId ?? null,
    project_id: m.projectId ?? null,
  };
  await client.request<unknown>(ctx, client.tableUrl('aios_memory_entries'), {
    method: 'POST',
    body: JSON.stringify(row),
    prefer: 'return=minimal',
  });
}

export interface MatchedMemory {
  id: string;
  title: string;
  body: string;
  label: MemoryLabel | null;
  supersededDraft: string | null;
  pinned: boolean;
  similarity: number;
}

interface MatchRow {
  id: string;
  title: string;
  body: string;
  label: MemoryLabel | null;
  superseded_draft: string | null;
  pinned: boolean;
  similarity: number;
}

export interface MatchOptions {
  organizationId: string;
  embedding: number[];
  scope?: MemoryScope;
  label?: MemoryLabel;
  limit?: number;
}

/** Top-N voorbeelden op pgvector-similarity (RPC `aios_match_memory`). */
export async function matchMemory(
  client: SupabaseClient,
  ctx: TenantContext,
  opts: MatchOptions,
): Promise<MatchedMemory[]> {
  const rows = await client.request<MatchRow[]>(ctx, client.rpcUrl('aios_match_memory'), {
    method: 'POST',
    body: JSON.stringify({
      p_org: opts.organizationId,
      p_embedding: vectorLiteral(opts.embedding),
      p_scope: opts.scope ?? null,
      p_label: opts.label ?? null,
      p_limit: opts.limit ?? 3,
    }),
  });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    label: r.label,
    supersededDraft: r.superseded_draft,
    pinned: r.pinned,
    similarity: r.similarity,
  }));
}

/**
 * Gepinde voorbeelden (handmatige "altijd als referentie"-vlag), los van
 * similarity — om de echokamer te doorbreken en curatie boven volume te zetten.
 */
export async function listPinnedMemory(
  client: SupabaseClient,
  ctx: TenantContext,
  opts: { organizationId: string; scope?: MemoryScope; label?: MemoryLabel; limit?: number },
): Promise<MatchedMemory[]> {
  const url = client.tableUrl('aios_memory_entries');
  url.searchParams.set('organization_id', `eq.${opts.organizationId}`);
  url.searchParams.set('pinned', 'is.true');
  url.searchParams.set('deleted_at', 'is.null');
  if (opts.scope) url.searchParams.set('scope', `eq.${opts.scope}`);
  if (opts.label) url.searchParams.set('label', `eq.${opts.label}`);
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', String(opts.limit ?? 2));
  url.searchParams.set('select', 'id,title,body,label,superseded_draft,pinned');
  const rows = await client.request<MatchRow[]>(ctx, url, { method: 'GET' });
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    label: r.label,
    supersededDraft: r.superseded_draft,
    pinned: r.pinned,
    similarity: 1,
  }));
}
