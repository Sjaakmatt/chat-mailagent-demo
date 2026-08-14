import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { cockpitEnv, makeClient, upsertBatch, deleteBatch } from "@/lib/db";

export const dynamic = "force-dynamic";

/** PATCH /api/batches/:id (admin) — batch bijwerken. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const env = cockpitEnv();
  if (!env.AIOS_ORG_ID) {
    return NextResponse.json({ error: "org_not_configured" }, { status: 503 });
  }

  const { id: raw } = await params;
  const id = decodeURIComponent(raw);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const sku = String(b.sku ?? "").trim();
  const label = String(b.label ?? "").trim();
  const startDate = String(b.startDate ?? "").trim();
  if (!sku || !label || !startDate) {
    return NextResponse.json({ error: "sku_label_startdate_required" }, { status: 400 });
  }

  try {
    await upsertBatch(makeClient(env), {
      id,
      organizationId: env.AIOS_ORG_ID,
      sku,
      category: typeof b.category === "string" ? b.category : null,
      color: typeof b.color === "string" && b.color ? b.color : "#7c3aed",
      label,
      startDate,
      endDate: typeof b.endDate === "string" && b.endDate ? b.endDate : null,
      notes: typeof b.notes === "string" ? b.notes : null,
    });
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}

/** DELETE /api/batches/:id (admin) — batch verwijderen. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  try {
    await deleteBatch(makeClient(cockpitEnv()), id);
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
