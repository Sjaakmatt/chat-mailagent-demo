import { NextRequest, NextResponse } from "next/server";
import { supabaseOnResponse } from "@/lib/supabase/server";
import { resolveRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify-code — verifieert de OTP-code (lengte volgt de Supabase
 * Auth-config) en zet de
 * sessie. Daarna stuurt de UI door naar /auth/update-password om een wachtwoord
 * in te stellen.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let email = "";
  let token = "";
  try {
    const body = (await request.json()) as { email?: string; token?: string };
    email = (body.email ?? "").trim().toLowerCase();
    token = (body.token ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!email || !token) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true, next: "/auth/update-password" });
  const supabase = supabaseOnResponse(request, response);
  if (!supabase) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error || !data.session) {
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }

  const user = await resolveRole(email);
  if (!user) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  return response;
}
