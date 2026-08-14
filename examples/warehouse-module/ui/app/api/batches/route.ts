import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { cockpitEnv, makeClient, listBatches, upsertBatch } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/batches (admin) — alle onderdeel-batches. */
export async function GET(): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  try {
    const batches = await listBatches(makeClient(cockpitEnv()));
    return NextResponse.json({ batches });
  } catch {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }
}

/** POST /api/batches (admin) — nieuwe batch. */
export async function POST(request: NextRequest): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const env = cockpitEnv();
  if (!env.AIOS_ORG_ID) {
    return NextResponse.json({ error: "org_not_configured" }, { status: 503 });
  }

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

  const id = `batch_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}
