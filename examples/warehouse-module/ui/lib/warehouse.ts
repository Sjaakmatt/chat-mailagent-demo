/**
 * VOORBEELD — magazijn-datalaag voor de cockpit (Sunwise).
 *
 * Uit `ui/lib/db.ts` gelicht toen de magazijn-module uit de kern ging.
 * Kopieer dit bestand naar `ui/lib/warehouse.ts` in een klant-repo die de
 * module nodig heeft, en importeer `CockpitDbClient` + `CTX` uit `./db`.
 */

import type { CockpitDbClient } from "./tenant-query";
import { CTX } from "./db";

// ---------------------------------------------------------------------------
// Magazijn / verzendtaken
// ---------------------------------------------------------------------------

export type ShipmentStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";

export interface ShipmentBatch {
  category?: string;
  label: string;
  color: string;
  notes?: string;
}

export interface ShipmentItem {
  sku?: string;
  name?: string;
  quantity?: number;
  /** Onderdeel-batches die golden op de besteldatum (kunnen er meerdere zijn). */
  batches?: ShipmentBatch[];
}

export interface ShipmentTaskRow {
  id: string;
  organization_id: string;
  review_item_id: string | null;
  signal_id: string | null;
  status: ShipmentStatus;
  customer_email: string | null;
  customer_name: string | null;
  customer_address: string | null;
  order_reference: string | null;
  description: string | null;
  items: ShipmentItem[] | null;
  label: string | null;
  triggered_by_rule_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completed_by: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
}

// ---------------------------------------------------------------------------
// Onderdeel-batches
// ---------------------------------------------------------------------------

export interface PartBatchRow {
  id: string;
  organization_id: string;
  sku: string;
  category: string | null;
  color: string;
  label: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listBatches(
  client: CockpitDbClient,
): Promise<PartBatchRow[]> {
  const url = client.tableUrl("aios_part_batches");
  url.searchParams.set("order", "sku.asc,start_date.desc");
  url.searchParams.set("limit", "1000");
  const rows = await client.request<PartBatchRow[]>(CTX, url, { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

export interface BatchInput {
  id: string;
  organizationId: string;
  sku: string;
  category?: string | null;
  color: string;
  label: string;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
}

export async function upsertBatch(
  client: CockpitDbClient,
  b: BatchInput,
): Promise<void> {
  const url = client.tableUrl("aios_part_batches");
  await client.request<unknown>(CTX, url, {
    method: "POST",
    body: JSON.stringify({
      id: b.id,
      organization_id: b.organizationId,
      sku: b.sku,
      category: b.category ?? null,
      color: b.color,
      label: b.label,
      start_date: b.startDate,
      end_date: b.endDate ?? null,
      notes: b.notes ?? null,
      updated_at: new Date().toISOString(),
    }),
    prefer: "return=minimal,resolution=merge-duplicates",
  });
}

export async function deleteBatch(
  client: CockpitDbClient,
  id: string,
): Promise<void> {
  const url = client.tableUrl("aios_part_batches");
  url.searchParams.set("id", `eq.${id}`);
  await client.request<unknown>(CTX, url, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

export async function getShipmentTask(
  client: CockpitDbClient,
  id: string,
): Promise<ShipmentTaskRow | undefined> {
  const url = client.tableUrl("aios_shipment_tasks");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");
  const rows = await client.request<ShipmentTaskRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows[0] : undefined;
}

/** Verzendtaak die bij een review-item hoort (audit-trail in mail-detail). */
export async function getShipmentTaskForReview(
  client: CockpitDbClient,
  reviewItemId: string,
): Promise<ShipmentTaskRow | undefined> {
  const url = client.tableUrl("aios_shipment_tasks");
  url.searchParams.set("review_item_id", `eq.${reviewItemId}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1");
  const rows = await client.request<ShipmentTaskRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows[0] : undefined;
}

export async function listShipmentTasks(
  client: CockpitDbClient,
): Promise<ShipmentTaskRow[]> {
  const url = client.tableUrl("aios_shipment_tasks");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "500");
  const rows = await client.request<ShipmentTaskRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Zet de status van een verzendtaak en houdt de audit-velden bij.
 *
 * Status-transities en bijwerkingen op de audit-velden:
 *   OPEN        → reset claim + completed
 *   IN_PROGRESS → claimed_at/claimed_by = actor; completed velden leeg
 *   DONE        → completed_at/completed_by = actor; claim-velden blijven
 *                 staan zoals ze waren (anders verlies je "Opgepakt door…")
 *   CANCELLED   → claim + completed worden leeggemaakt
 *
 * Hiermee kun je een ticket "Oppakken" (OPEN→IN_PROGRESS), "Loslaten"
 * (IN_PROGRESS→OPEN), "Markeer verstuurd" (IN_PROGRESS/OPEN→DONE) of
 * "Heropenen" (DONE→OPEN) zonder de audit-historie te verliezen.
 */
export async function updateShipmentStatus(
  client: CockpitDbClient,
  id: string,
  status: ShipmentStatus,
  actor?: string | null,
): Promise<void> {
  const url = client.tableUrl("aios_shipment_tasks");
  url.searchParams.set("id", `eq.${id}`);
  const now = new Date().toISOString();
  const body: Record<string, unknown> = {
    status,
    updated_at: now,
  };
  if (status === "IN_PROGRESS") {
    body.claimed_at = now;
    body.claimed_by = actor ?? null;
    body.completed_at = null;
    body.completed_by = null;
  } else if (status === "DONE") {
    body.completed_at = now;
    body.completed_by = actor ?? null;
    // claim-velden bewust niét resetten — anders zie je niet meer
    // wie 'm opgepakt heeft vóór 'ie werd verstuurd.
  } else if (status === "OPEN" || status === "CANCELLED") {
    body.claimed_at = null;
    body.claimed_by = null;
    body.completed_at = null;
    body.completed_by = null;
  }
  await client.request<unknown>(CTX, url, {
    method: "PATCH",
    body: JSON.stringify(body),
    prefer: "return=minimal",
  });
}
