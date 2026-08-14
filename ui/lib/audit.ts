import type { AuditEntry, ReviewMetricRow } from "./db";

/**
 * Mensvriendelijke actie-labels. De kern kent alleen review-beslissingen;
 * een domeinmodule voegt hier haar eigen acties aan toe door de map uit te
 * breiden (zie `examples/warehouse-module`).
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  APPROVED: "Goedgekeurd",
  EDITED: "Bewerkt",
  EXECUTED: "Verstuurd",
  REJECTED: "Afgewezen",
};

/** Filtert besliste items (geen PENDING) op status + vrije tekst, nieuwste eerst. */
export function filterAudit(
  rows: ReviewMetricRow[],
  status: string,
  q: string,
): ReviewMetricRow[] {
  const needle = q.trim().toLowerCase();
  return rows
    .filter((r) => r.status !== "PENDING")
    .filter((r) => (status ? r.status === status : true))
    .filter((r) =>
      needle
        ? (r.summary ?? "").toLowerCase().includes(needle) ||
          (r.decided_by ?? "").toLowerCase().includes(needle)
        : true,
    )
    .sort((a, b) =>
      (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at),
    );
}

function csvCell(value: string): string {
  // RFC4180: dubbele quotes verdubbelen, en quoten als er speciale tekens zijn.
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Serialiseert audit-rijen naar CSV (met header). */
export function auditToCsv(rows: ReviewMetricRow[]): string {
  const header = [
    "beslist_op",
    "actie",
    "reviewer",
    "categorie",
    "onderwerp",
    "vertrouwen",
    "id",
  ];
  const lines = rows.map((r) =>
    [
      r.decided_at ?? r.created_at ?? "",
      AUDIT_ACTION_LABEL[r.status] ?? r.status,
      r.decided_by ?? "",
      r.category ?? "",
      r.summary ?? "",
      r.confidence != null ? String(Math.round(r.confidence * 100)) + "%" : "",
      r.id,
    ]
      .map((c) => csvCell(String(c)))
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}

/** Serialiseert de geünificeerde audit-tijdlijn (mail + domeinbronnen) naar CSV. */
export function auditEntriesToCsv(entries: AuditEntry[]): string {
  const header = [
    "tijdstip",
    "bron",
    "actie",
    "door",
    "omschrijving",
    "extra",
    "review_item_id",
    "domein_ref",
    "domein_label",
  ];
  const lines = entries.map((e) =>
    [
      e.at,
      e.source === "review" ? "mail" : e.source,
      AUDIT_ACTION_LABEL[e.action] ?? e.action,
      e.by ?? "",
      e.summary,
      e.meta ?? "",
      e.reviewItemId ?? "",
      e.domainRef ?? "",
      e.domainLabel ?? "",
    ]
      .map((c) => csvCell(String(c)))
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}
