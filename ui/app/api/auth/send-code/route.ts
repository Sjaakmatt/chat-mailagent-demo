import { NextRequest, NextResponse } from "next/server";
import { supabaseAnon } from "@/lib/supabase/server";
import { resolveRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/send-code — stuurt een OTP-code per e-mail
 * (invite/eerste login/wachtwoord vergeten). Antwoordt altijd neutraal `{ok}`
 * zodat niet zichtbaar is of een adres bestaat; we versturen alleen echt als
 * het adres op de allowlist staat. `shouldCreateUser:false` = geen self-signup.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let email = "";
  try {
    const body = (await request.json()) as { email?: string };
    email = (body.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!email) return NextResponse.json({ error: "missing_email" }, { status: 400 });

  const allowed = await resolveRole(email);
  if (allowed) {
    const supabase = supabaseAnon();
    if (supabase) {
      await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
