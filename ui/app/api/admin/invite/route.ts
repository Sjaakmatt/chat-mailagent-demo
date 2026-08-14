import { NextRequest, NextResponse } from "next/server";
import { requireRole, type Role } from "@/lib/auth/require-role";
import { supabaseAdmin, supabaseAnon } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["admin", "reviewer", "viewer"];

/**
 * POST /api/admin/invite  (admin-only)
 * Body: { email, role }
 *
 * Nodigt een gebruiker uit: zet het adres op de allowlist met rol, maakt de
 * (wachtwoordloze) auth-user aan, en stuurt een OTP-code per e-mail. De
 * gebruiker voert de code in op /auth (verify) en stelt dan een wachtwoord in.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  let email = "";
  let role: Role = "reviewer";
  try {
    const body = (await request.json()) as { email?: string; role?: string };
    email = (body.email ?? "").trim().toLowerCase();
    if (body.role && ROLES.includes(body.role as Role)) role = body.role as Role;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  // 1. Op de allowlist (met rol) zetten.
  const { error: upsertErr } = await admin
    .from("allowed_emails")
    .upsert({ email, role }, { onConflict: "email" });
  if (upsertErr) {
    return NextResponse.json({ error: "allowlist_failed" }, { status: 500 });
  }

  // 2. Wachtwoordloze auth-user aanmaken (bestaat 'ie al → negeren).
  await admin.auth.admin.createUser({ email, email_confirm: true });

  // 3. OTP-code mailen (de "uitnodiging").
  const anon = supabaseAnon();
  if (anon) {
    await anon.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
  }

  return NextResponse.json({ ok: true, email, role });
}
