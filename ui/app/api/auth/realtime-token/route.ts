import { NextResponse } from "next/server";
import { supabaseFromCookies } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/realtime-token — geeft de access-token van de huidige sessie
 * terug zodat de browser de Realtime-websocket als `authenticated` kan
 * subscriben. Onze auth-cookies zijn niet altijd direct leesbaar voor de
 * browser-supabase-client; deze endpoint zorgt dat realtime gegarandeerd
 * door de RLS-policy "authenticated read ..." gelaten wordt.
 *
 * Veilig: alleen de access-token (kort levend, ~1u) — geen refresh-token.
 * Beschikbaar voor ingelogde sessies; anders 401.
 */
export async function GET(): Promise<Response> {
  const supabase = await supabaseFromCookies();
  if (!supabase) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  return NextResponse.json({
    accessToken: data.session.access_token,
    expiresAt: data.session.expires_at ?? null,
  });
}
