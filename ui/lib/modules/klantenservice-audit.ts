/**
 * Tickets op de auditlog-tijdlijn.
 *
 * De kern-auditlog toont mail-beslissingen (goedkeuren, bewerken, verzenden).
 * Wat daar níét op stond, is wat er ná de goedkeuring met het uitzoekwerk
 * gebeurde: wie het ticket oppakte en wie het afsloot. Dat is precies het deel
 * waar een klant naar vraagt als hij wil weten waarom iets lang duurde.
 *
 * ## Drie gebeurtenissen, geen momentopname
 *
 * `aios_tickets` heeft geen historie-tabel, maar wel drie tijdstempels met een
 * actor erbij: `created_at`, `claimed_at`/`claimed_by`, `closed_at`/`closed_by`.
 * Daaruit zijn drie echte events af te leiden. Eén rij levert er dus meerdere.
 *
 * Wat dit **niet** kan: een ticket dat twee keer van eigenaar wisselde toont
 * alleen de laatste claim. Zonder historie-tabel is dat niet op te lossen, en
 * het is beter dat hier te zeggen dan een tijdlijn te tonen die volledig lijkt.
 */

import { CLAIMED, CLOSED, CREATED } from "./klantenservice-audit-actions";
import type { AuditEntry, AuditQuery } from "@/lib/db";
import { CTX } from "@/lib/db";
import type { CockpitDbClient } from "@/lib/tenant-query";
import type { TicketRow } from "@/lib/tickets";
import type { DomainAuditSource } from "@/lib/audit-sources";

const LABELS: Record<string, string> = {
  [CREATED]: "Ticket aangemaakt",
  [CLAIMED]: "Ticket opgepakt",
  [CLOSED]: "Ticket afgesloten",
};

/** Binnen het datumvenster van de query? Leeg venster = alles. */
function inRange(at: string, q: AuditQuery): boolean {
  if (q.from && at < q.from) return false;
  // `to` is een dag, niet een moment: tot en met die dag.
  if (q.to && at.slice(0, 10) > q.to) return false;
  return true;
}

function entry(
  row: TicketRow,
  action: string,
  at: string,
  by: string | null,
): AuditEntry {
  return {
    // Stabiel én uniek: één rij levert meerdere events, dus de actie hoort
    // in de sleutel.
    key: `ticket:${row.id}:${action}`,
    source: "tickets",
    action,
    by,
    at,
    summary: `${row.number} — ${row.summary}`,
    meta: [row.category, row.order_reference].filter(Boolean).join(" · ") || null,
    reviewItemId: row.review_item_id,
    domainRef: row.id,
    domainLabel: row.number,
  };
}

/**
 * De ticket-events, al gefilterd op wat PostgREST kan en de rest in code.
 *
 * De datum- en actorfilters kunnen niet naar de database: één rij levert
 * events op drie verschillende momenten met drie verschillende actors, dus
 * filteren op rijniveau zou de verkeerde events weggooien. Daarom halen we een
 * ruimer venster op en zeven we hier.
 */
async function fetchTicketEvents(
  client: CockpitDbClient,
  query: AuditQuery,
  cap: number,
): Promise<AuditEntry[]> {
  const url = client.tableUrl("aios_tickets");
  url.searchParams.set("order", "updated_at.desc");
  // Ruimer dan `cap`, want niet elke rij levert een event dat door de filters
  // komt. Begrensd, want dit is een auditscherm en geen export.
  url.searchParams.set("limit", String(Math.min(cap * 3, 600)));
  if (query.category) url.searchParams.set("category", `eq.${query.category}`);

  const rows = await client.request<TicketRow[]>(CTX, url, { method: "GET" });
  if (!Array.isArray(rows)) return [];

  const out: AuditEntry[] = [];
  for (const row of rows) {
    const kandidaten: [string, string | null, string | null][] = [
      [CREATED, row.created_at, null],
      [CLAIMED, row.claimed_at, row.claimed_by],
      [CLOSED, row.closed_at, row.closed_by],
    ];
    for (const [action, at, by] of kandidaten) {
      if (!at) continue;
      if (query.status && query.status !== action) continue;
      if (!inRange(at, query)) continue;
      if (query.decidedBy && by !== query.decidedBy) continue;
      if (query.q) {
        const hooi = `${row.number} ${row.summary} ${row.order_reference ?? ""}`;
        if (!hooi.toLowerCase().includes(query.q.toLowerCase())) continue;
      }
      out.push(entry(row, action, at, by));
    }
  }

  out.sort((a, b) => (a.at < b.at ? 1 : -1));
  return out.slice(0, cap);
}

export const klantenserviceAuditSource: DomainAuditSource = {
  id: "tickets",
  label: "Tickets",
  actions: [CREATED, CLAIMED, CLOSED],
  actionLabels: LABELS,
  fetch: fetchTicketEvents,
  async actors(client) {
    const url = client.tableUrl("aios_tickets");
    url.searchParams.set("select", "claimed_by,closed_by");
    url.searchParams.set("limit", "500");
    const rows = await client.request<
      { claimed_by: string | null; closed_by: string | null }[]
    >(CTX, url, { method: "GET" });
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.claimed_by) seen.add(r.claimed_by);
      if (r.closed_by) seen.add(r.closed_by);
    }
    return [...seen].sort();
  },
  linkHref: (e) => (e.domainRef ? `/tickets?focus=${encodeURIComponent(e.domainRef)}` : null),
};
