import { NextRequest, NextResponse } from "next/server";
import { supabaseOnResponse } from "@/lib/supabase/server";
import { resolveRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

/** POST /api/auth/sign-in — e-mail + wachtwoord. */
export async function POST(request: NextRequest): Promise<Response> {
  let email = "";
  let password = "";
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    email = (body.email ?? "").trim().toLowerCase();
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  const supabase = supabaseOnResponse(request, response);
  if (!supabase) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    return NextResponse.json({ error: "invalid_login" }, { status: 401 });
  }

  // Allowlist-check: wel een geldige Supabase-user, maar geen toegang → weigeren.
  const user = await resolveRole(email);
  if (!user) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  return response;
}
