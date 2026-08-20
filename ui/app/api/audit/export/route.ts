import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/access";
import { cockpitEnv, makeClient, listAuditEntriesForExport } from "@/lib/db";
import { allowedDomainSources } from "@/lib/audit-sources";
import { auditEntriesToCsv } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit/export?status=&q=&from=&to=  — CSV van besliste ReviewItems.
 * Zelfde server-side filtering als de auditlog-pagina (geen paginering: alle
 * matches tot een hoge cap). Reviewer+ mag exporteren.
 *
 * De modulegrens loopt via `requireAccess` en niet via `requireRole`. Dat was
 * het gat: de pagina toonde straks alleen je eigen afdelingen, maar de export
 * erachter keek alleen naar de rang — dus stond de hele auditlog van elk proces
 * één klik verderop in een CSV.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const me = await requireAccess("reviewer");
  if (me instanceof NextResponse) return me;

  const p = request.nextUrl.searchParams;
  const src = p.get("source");
  const validSources = [
    "review",
    ...allowedDomainSources(me.modules).map((d) => d.id),
  ];
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
      modules: me.modules,
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
