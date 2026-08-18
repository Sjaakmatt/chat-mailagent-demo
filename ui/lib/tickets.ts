import { canTransition, type Ticket, type TicketStatus } from "@factumai/agent-core";
import type { CockpitDbClient } from "./tenant-query";
import { CTX } from "./db";

/** Rij zoals PostgREST 'm teruggeeft (snake_case). */
export interface TicketRow {
  id: string;
  organization_id: string;
  number: string;
  conversation_id: string | null;
  review_item_id: string | null;
  status: TicketStatus;
  category: string | null;
  summary: string;
  contact_email: string | null;
  order_reference: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    organizationId: r.organization_id,
    number: r.number,
    conversationId: r.conversation_id,
    reviewItemId: r.review_item_id,
    status: r.status,
    category: r.category,
    summary: r.summary,
    contactEmail: r.contact_email,
    orderReference: r.order_reference,
    claimedAt: r.claimed_at,
    claimedBy: r.claimed_by,
    closedAt: r.closed_at,
    closedBy: r.closed_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Open tickets eerst; afgehandelde alleen van de laatste week. */
export async function listTickets(
  client: CockpitDbClient,
  opts: { status?: TicketStatus; limit?: number } = {},
): Promise<Ticket[]> {
  const url = client.tableUrl("aios_tickets");
  if (opts.status) url.searchParams.set("status", `eq.${opts.status}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(opts.limit ?? 200));
  const rows = await client.request<TicketRow[]>(CTX, url, { method: "GET" });
  return (Array.isArray(rows) ? rows : []).map(rowToTicket);
}

export async function getTicket(
  client: CockpitDbClient,
  id: string,
): Promise<Ticket | undefined> {
  const url = client.tableUrl("aios_tickets");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");
  const rows = await client.request<TicketRow[]>(CTX, url, { method: "GET" });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? rowToTicket(row) : undefined;
}

/**
 * Zet de status, met de overgangsregels uit agent-core ertussen. Een ongeldige
 * sprong (bv. CANCELLED terug naar OPEN) wordt geweigerd in plaats van
 * stilzwijgend uitgevoerd — anders raakt de historie zoek.
 */
export async function updateTicketStatus(
  client: CockpitDbClient,
  id: string,
  next: TicketStatus,
  actor: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getTicket(client, id);
  if (!current) return { ok: false, error: "Ticket niet gevonden" };
  if (current.status === next) return { ok: true };
  if (!canTransition(current.status, next)) {
    return { ok: false, error: `Overgang ${current.status} → ${next} is niet toegestaan` };
  }

  const now = new Date().toISOString();
  const body: Record<string, unknown> = { status: next, updated_at: now };

  if (next === "IN_PROGRESS") {
    body.claimed_at = now;
    body.claimed_by = actor;
    body.closed_at = null;
    body.closed_by = null;
  } else if (next === "DONE" || next === "CANCELLED") {
    body.closed_at = now;
    body.closed_by = actor;
    // claim-velden bewust laten staan: je wilt kunnen zien wie 'm oppakte.
  } else if (next === "OPEN") {
    body.claimed_at = null;
    body.claimed_by = null;
    body.closed_at = null;
    body.closed_by = null;
  }

  const url = client.tableUrl("aios_tickets");
  url.searchParams.set("id", `eq.${id}`);
  await client.request<unknown>(CTX, url, {
    method: "PATCH",
    body: JSON.stringify(body),
    prefer: "return=minimal",
  });
  return { ok: true };
}


/**
 * Het ticket dat bij dit concept hoort, als het er is.
 *
 * Voor de verwijzing op het werkitem. Het werkitem gaat over het antwoord; het
 * uitzoekwerk en de schrijfoperaties leven in het ticket. Een link ertussen is
 * wat die twee schermen verbindt zonder ze door elkaar te halen.
 */
export async function getTicketForReviewItem(
  client: CockpitDbClient,
  reviewItemId: string,
): Promise<Ticket | undefined> {
  const url = client.tableUrl("aios_tickets");
  url.searchParams.set("review_item_id", `eq.${reviewItemId}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1");
  const rows = await client.request<TicketRow[]>(CTX, url, { method: "GET" });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? rowToTicket(row) : undefined;
}
