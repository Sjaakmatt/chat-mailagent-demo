import { NextRequest, NextResponse } from "next/server";
import { supabaseOnResponse } from "@/lib/supabase/server";
import { resolveRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/update-password — stelt het wachtwoord in voor de ingelogde
 * sessie (na OTP-verificatie). Vereist dus een geldige sessie-cookie.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let password = "";
  try {
    const body = (await request.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (password.length < 10) {
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  }

  // Eén try/catch zodat we nooit een naakt 500-scherm teruggeven — @supabase/ssr
  // / GoTrue kan throwen (cookies, token-refresh, netwerk). De UI toont dan
  // tenminste een zinnige melding i.p.v. de framework-error.
  try {
    const response = NextResponse.json({ ok: true });
    const supabase = supabaseOnResponse(request, response);
    if (!supabase) {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }

    const {
      data: { user },
      error: getUserErr,
    } = await supabase.auth.getUser();
    if (getUserErr || !user) {
      console.warn("[update-password] no_session:", getUserErr?.message);
      return NextResponse.json({ error: "no_session" }, { status: 401 });
    }
    const email = user.email?.toLowerCase();
    if (!email) return NextResponse.json({ error: "no_session" }, { status: 401 });
    if (!(await resolveRole(email))) {
      return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      // Bijv. "New password should be different from the old password",
      // "Password should be at least N characters", policy-checks, ...
      console.warn("[update-password] updateUser:", updateErr.message);
      return NextResponse.json(
        { error: "update_failed", message: updateErr.message },
        { status: 400 },
      );
    }
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[update-password] crash:", message);
    return NextResponse.json(
      { error: "server_error", message },
      { status: 500 },
    );
  }
}
