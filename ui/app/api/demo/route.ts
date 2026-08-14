import { NextRequest, NextResponse } from "next/server";
import { cockpitEnv, makeClient } from "@/lib/db";
import { requireRole } from "@/lib/auth/require-role";
import { seedDemo, resetDemo } from "@/lib/demo/seed";
import { isDemoEnabled } from "@/lib/demo/enabled";

export const dynamic = "force-dynamic";

/** Fail-closed: zonder expliciete DEMO_MODE bestaat dit endpoint niet. */
function demoGuard(): NextResponse | null {
  if (isDemoEnabled(cockpitEnv())) return null;
  return NextResponse.json({ error: "Demo-modus staat uit" }, { status: 404 });
}

/**
 * POST /api/demo — zet de demo-mails op de work-bus. Admin-only: het injecteert
 * signalen in dezelfde pipeline als echte klantmail.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const blocked = demoGuard();
  if (blocked) return blocked;

  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  let keys: string[] | undefined;
  try {
    const body = (await request.json()) as { keys?: string[] };
    keys = Array.isArray(body?.keys) ? body.keys : undefined;
  } catch {
    keys = undefined;
  }

  try {
    const result = await seedDemo(makeClient(cockpitEnv()), keys);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Demo starten mislukt: ${msg}` },
      { status: 500 },
    );
  }
}

/** DELETE /api/demo — ruimt alleen de demo-signalen en hun ReviewItems op. */
export async function DELETE(): Promise<Response> {
  const blocked = demoGuard();
  if (blocked) return blocked;

  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  try {
    const removed = await resetDemo(makeClient(cockpitEnv()));
    return NextResponse.json({ removed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Demo opruimen mislukt: ${msg}` },
      { status: 500 },
    );
  }
}
