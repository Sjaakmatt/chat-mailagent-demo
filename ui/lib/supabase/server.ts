import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { authEnv } from "./env";

/**
 * Supabase Auth-client gebonden aan de Next-cookies (Server Components /
 * Route Handlers die niet zelf cookies hoeven te zetten — bv. getUser()).
 */
export async function supabaseFromCookies(): Promise<SupabaseClient | null> {
  const env = authEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.anon, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          // RSC render-context: cookies worden door de middleware ververst.
        }
      },
    },
  });
}

/**
 * Auth-client die de sessie-cookies op een uitgaande response zet. Voor route
 * handlers die in-/uitloggen of een OTP verifiëren (de Set-Cookie headers
 * moeten op de response die we teruggeven, niet via next/headers).
 */
export function supabaseOnResponse(
  request: NextRequest,
  response: NextResponse,
): SupabaseClient | null {
  const env = authEnv();
  if (!env) return null;
  return createServerClient(env.url, env.anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
}

/**
 * Service-role-client (bypasst RLS). ALLEEN server-side: allowed_emails-lookups
 * en het uitnodigen/aanmaken van gebruikers. Nooit naar de browser.
 */
export function supabaseAdmin(): SupabaseClient | null {
  const env = authEnv();
  if (!env) return null;
  return createClient(env.url, env.serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Anon-client zonder sessie — voor het versturen van een OTP-code-mail
 * (`signInWithOtp`). Zet geen cookies.
 */
export function supabaseAnon(): SupabaseClient | null {
  const env = authEnv();
  if (!env) return null;
  return createClient(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
