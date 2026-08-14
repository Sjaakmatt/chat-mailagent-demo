import { NextRequest, NextResponse } from "next/server";
import { requireRole, type Role } from "@/lib/auth/require-role";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["admin", "reviewer", "viewer"];

/**
 * PATCH /api/admin/allowed-emails/:email  (admin-only)
 * Body: { role }. Wijzigt de rol van een gebruiker op de allowlist.
 * Een admin kan zichzelf niet degraderen (lockout-bescherming).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const { email: raw } = await params;
  const email = decodeURIComponent(raw).toLowerCase();

  let role: Role | undefined;
  try {
    const body = (await request.json()) as { role?: string };
    if (body.role && ROLES.includes(body.role as Role)) role = body.role as Role;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!role) return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  if (email === guard.email && role !== "admin") {
    return NextResponse.json({ error: "cannot_demote_self" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const { error } = await admin
    .from("allowed_emails")
    .update({ role })
    .eq("email", email);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  return NextResponse.json({ ok: true, email, role });
}

/**
 * DELETE /api/admin/allowed-emails/:email  (admin-only)
 * Verwijdert het adres van de allowlist (= toegang intrekken). De auth-user
 * blijft bestaan maar kan zonder allowlist-rol niet meer inloggen.
 * Je kunt jezelf niet verwijderen (lockout-bescherming).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const { email: raw } = await params;
  const email = decodeURIComponent(raw).toLowerCase();
  if (email === guard.email) {
    return NextResponse.json({ error: "cannot_remove_self" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const { error } = await admin.from("allowed_emails").delete().eq("email", email);
  if (error) return NextResponse.json({ error: "delete_failed" }, { status: 500 });

  return NextResponse.json({ ok: true, email });
}
