import { NextRequest, NextResponse } from "next/server";
import {
  ROLES,
  isDomainRule,
  isValidAllowlistEntry,
  normalizeEmail,
} from "@factumai/agent-core";
import { requireRole, type Role } from "@/lib/auth/require-role";
import { supabaseAdmin, supabaseAnon } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/invite  (admin-only)
 * Body: { email, role }
 *
 * Nodigt een gebruiker uit: zet het adres op de allowlist met rol, maakt de
 * (wachtwoordloze) auth-user aan, en stuurt een OTP-code per e-mail. De
 * gebruiker voert de code in op /auth (verify) en stelt dan een wachtwoord in.
 *
 * `email` mag ook een domeinregel zijn (`@klant.nl`) — dan krijgt iedereen op
 * dat domein deze rol. Er valt dan niets te mailen: de regel gaat alleen op de
 * allowlist, en de eerste keer dat zo iemand inlogt maakt Supabase Auth de user
 * vanzelf aan.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  let email = "";
  let role: Role = "reviewer";
  try {
    const body = (await request.json()) as { email?: string; role?: string };
    email = normalizeEmail(body.email ?? "");
    if (body.role && ROLES.includes(body.role as Role)) role = body.role as Role;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!isValidAllowlistEntry(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  // 1. Op de allowlist (met rol) zetten.
  const { error: upsertErr } = await admin
    .from("allowed_emails")
    .upsert({ email, role, invited_by: guard.email }, { onConflict: "email" });
  if (upsertErr) {
    return NextResponse.json({ error: "allowlist_failed" }, { status: 500 });
  }

  // Een domeinregel heeft geen postvak — hier stopt het.
  if (isDomainRule(email)) {
    return NextResponse.json({ ok: true, email, role, domain: true });
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
