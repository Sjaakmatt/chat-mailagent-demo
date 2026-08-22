import { NextRequest, NextResponse } from "next/server";
import type { TicketStatus } from "@factumai/agent-core";

import { cockpitEnv, makeClient } from "@/lib/db";
import { accessFor, requireAccess } from "@/lib/auth/access";
import { moduleById } from "@/lib/modules";
import { ticketModule, updateTicketStatus } from "@/lib/tickets";

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
  // Rol eerst, module daarna. Alleen op rol toetsen liet een reviewer uit een
  // andere afdeling een ticket van deze afdeling afhandelen — genoeg rang,
  // verkeerd proces.
  //
  // Welke module dat is, stond hier tot fase 4 hardgecodeerd op
  // klantenservice. Nu komt hij van de rij: zodra administratie eigen tickets
  // heeft, klopt deze route zonder wijziging.
  const guard = await requireAccess("reviewer");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const client = makeClient(cockpitEnv());

  const mod = moduleById((await ticketModule(client, id)) ?? "");
  if (!mod) {
    return NextResponse.json({ error: "Ticket niet gevonden" }, { status: 404 });
  }
  const me = await accessFor(guard);
  if (!me.access.mayEnter(mod.id)) {
    return NextResponse.json(
      { error: "Forbidden", reason: "module" },
      { status: 403 },
    );
  }

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
      client,
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
