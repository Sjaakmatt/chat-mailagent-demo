import { NextRequest, NextResponse } from "next/server";
import type { TicketStatus } from "@factumai/agent-core";
import { cockpitEnv, makeClient } from "@/lib/db";
import { requireRole } from "@/lib/auth/require-role";
import { updateTicketStatus } from "@/lib/tickets";

export const dynamic = "force-dynamic";

const GELDIG: TicketStatus[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];

/**
 * PATCH /api/tickets/:id — status wijzigen. Reviewer+ mag afhandelen; viewers
 * kijken alleen mee.
 *
 * De overgangsregels zitten in agent-core en worden hier afgedwongen, niet in
 * de UI: een knop verbergen is geen beveiliging.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("reviewer");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  let status: unknown;
  try {
    ({ status } = (await request.json()) as { status?: unknown });
  } catch {
    return NextResponse.json({ error: "Ongeldige body" }, { status: 400 });
  }

  if (typeof status !== "string" || !GELDIG.includes(status as TicketStatus)) {
    return NextResponse.json(
      { error: `status moet een van ${GELDIG.join(", ")} zijn` },
      { status: 400 },
    );
  }

  try {
    const res = await updateTicketStatus(
      makeClient(cockpitEnv()),
      id,
      status as TicketStatus,
      guard.email,
    );
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Bijwerken mislukt: ${msg}` }, { status: 500 });
  }
}
