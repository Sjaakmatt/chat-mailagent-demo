import { NextRequest, NextResponse } from "next/server";
import { mayAssignModule } from "@factumai/agent-core";
import { requireRole, type Role } from "@/lib/auth/require-role";
import { licensedModules } from "@/lib/auth/access";
import { cockpitEnv } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["admin", "reviewer", "viewer"];

/**
 * PATCH /api/admin/allowed-emails/:email  (admin-only)
 * Body: { role?, modules? }. Wijzigt de rol en/of de afdelingen van een
 * gebruiker op de allowlist.
 *
 * Een admin kan zichzelf niet degraderen (lockout-bescherming), en niemand kan
 * een afdeling toewijzen die de organisatie niet heeft afgenomen. Die laatste
 * check staat hier en niet alleen in de UI: een scherm dat alleen het juiste
 * tóónt, is geen beveiliging.
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
  let modules: string[] | undefined;
  try {
    const body = (await request.json()) as { role?: string; modules?: unknown };
    if (body.role && ROLES.includes(body.role as Role)) role = body.role as Role;
    if (Array.isArray(body.modules)) {
      modules = body.modules.filter((m): m is string => typeof m === "string");
    }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!role && !modules) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (role && email === guard.email && role !== "admin") {
    return NextResponse.json({ error: "cannot_demote_self" }, { status: 400 });
  }

  if (modules) {
    const licensed = licensedModules(cockpitEnv());
    const buiten = modules.filter((m) => !mayAssignModule(licensed, m));
    if (buiten.length > 0) {
      // Wij verkopen per afdeling; een beheerder bij de klant kan zijn eigen
      // organisatie niet uitbreiden.
      return NextResponse.json(
        { error: "module_not_licensed", modules: buiten },
        { status: 403 },
      );
    }
  }

  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const { error } = await admin
    .from("allowed_emails")
    .update({ ...(role ? { role } : {}), ...(modules ? { modules } : {}) })
    .eq("email", email);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  return NextResponse.json({ ok: true, email, ...(role ? { role } : {}), ...(modules ? { modules } : {}) });
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
