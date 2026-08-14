import { NextResponse } from "next/server";
import { cockpitEnv, makeClient, listReviewItems } from "@/lib/db";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

/** Optionele JSON-lijst van ReviewItems (de werkbak-page laadt server-side). */
export async function GET(): Promise<Response> {
  const guard = await requireRole("viewer");
  if (guard instanceof NextResponse) return guard;
  try {
    const client = makeClient(cockpitEnv());
    const rows = await listReviewItems(client);
    return NextResponse.json({ items: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Kon ReviewItems niet laden: ${msg}`, {
      status: 500,
    });
  }
}
