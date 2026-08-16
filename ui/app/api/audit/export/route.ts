import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { cockpitEnv, makeClient, listAuditEntriesForExport } from "@/lib/db";
import { domainAuditSources } from "@/lib/audit-sources";
import { auditEntriesToCsv } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit/export?status=&q=&from=&to=  — CSV van besliste ReviewItems.
 * Zelfde server-side filtering als de auditlog-pagina (geen paginering: alle
 * matches tot een hoge cap). Reviewer+ mag exporteren.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const guard = await requireRole("reviewer");
  if (guard instanceof NextResponse) return guard;

  const p = request.nextUrl.searchParams;
  const src = p.get("source");
  const validSources = ["review", ...domainAuditSources().map((d) => d.id)];
  const source: string = src && validSources.includes(src) ? src : "all";
  let entries;
  try {
    entries = await listAuditEntriesForExport(makeClient(cockpitEnv()), {
      status: p.get("status") ?? undefined,
      q: p.get("q") ?? undefined,
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      decidedBy: p.get("decidedBy") ?? undefined,
      category: p.get("category") ?? undefined,
      source,
    });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const csv = auditEntriesToCsv(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditlog-${stamp}.csv"`,
    },
  });
}
