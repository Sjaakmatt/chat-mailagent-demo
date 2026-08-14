import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import {
  cockpitEnv,
  makeClient,
  updateShipmentStatus,
  type ShipmentStatus,
} from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUSES: ShipmentStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
];

/** PATCH /api/shipments/:id (reviewer+) — status bijwerken. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("reviewer");
  if (guard instanceof NextResponse) return guard;

  const { id: raw } = await params;
  const id = decodeURIComponent(raw);

  let status: ShipmentStatus | undefined;
  try {
    const b = (await request.json()) as { status?: string };
    if (b.status && STATUSES.includes(b.status as ShipmentStatus)) {
      status = b.status as ShipmentStatus;
    }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!status) return NextResponse.json({ error: "invalid_status" }, { status: 400 });

  try {
    await updateShipmentStatus(
      makeClient(cockpitEnv()),
      id,
      status,
      // Audit-trail: actor doorgeven; updateShipmentStatus bepaalt of het in
      // claimed_by (IN_PROGRESS) of completed_by (DONE) hoort.
      guard.email,
    );
    return NextResponse.json({ ok: true, id, status });
  } catch {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
