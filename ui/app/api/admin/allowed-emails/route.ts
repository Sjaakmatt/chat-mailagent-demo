import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/allowed-emails  (admin-only)
 * Lijst van toegestane gebruikers (allowlist) met rol.
 */
export async function GET(): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const { data, error } = await admin
    .from("allowed_emails")
    .select("email, role, invited_by, created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "list_failed" }, { status: 500 });

  return NextResponse.json({ users: data ?? [] });
}
