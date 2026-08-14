import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authEnv } from "@/lib/supabase/env";

/**
 * Auth-poort op Supabase-sessie (e-mail + wachtwoord; OTP-code voor invite/reset).
 * Vervangt de oude Basic-auth. Publieke paden mogen door; al het andere vereist
 * een geldige sessie, anders redirect naar /sign-in (browser) of 401 (API).
 *
 * Productie-aanrader: zet Cloudflare Access ervóór als extra ring (Build
 * Document B4) — deze app-laag is de functionele toegang + rollen.
 */
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/auth/", // verify-code + update-password pagina's
  "/api/auth/", // sign-in / send-code / verify-code / update-password / sign-out
  "/_next/",
  "/favicon",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const env = authEnv();
  // Fail-closed: zonder auth-config geen toegang.
  if (!env) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Service unavailable: auth not configured" },
        { status: 503 },
      );
    }
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.searchParams.set("error", "config");
    return NextResponse.redirect(signIn);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.searchParams.set("next", pathname);
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
