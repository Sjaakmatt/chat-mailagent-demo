import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { cockpitEnv, makeClient, listShipmentTasks } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/shipments (reviewer+) — alle verzendtaken. */
export async function GET(): Promise<Response> {
  const guard = await requireRole("reviewer");
  if (guard instanceof NextResponse) return guard;
  try {
    const tasks = await listShipmentTasks(makeClient(cockpitEnv()));
    return NextResponse.json({ tasks });
  } catch {
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }
}
