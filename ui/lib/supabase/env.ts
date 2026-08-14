import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Auth-config van de cockpit. De cockpit gebruikt Supabase Auth (e-mail +
 * wachtwoord) op het klant-project — hetzelfde project als de data.
 *
 * - `url`         : AIOS_SUPABASE_URL (gedeeld met de data-laag)
 * - `anon`        : SUPABASE_ANON_KEY (publieke key — voor de auth-client)
 * - `serviceRole` : AIOS_SUPABASE_SERVICE_ROLE_KEY (admin: allowed_emails + invite)
 *
 * Op OpenNext/Cloudflare zijn secrets zowel via getCloudflareContext().env als
 * via process.env beschikbaar; we proberen beide zodat dit in route handlers,
 * server components én middleware werkt.
 */
export interface AuthEnv {
  url: string;
  anon: string;
  serviceRole: string;
}

function read(key: string): string | undefined {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, string>;
    if (env?.[key]) return env[key];
  } catch {
    // geen cloudflare-context (bv. middleware) → val terug op process.env
  }
  return process.env[key];
}

export function authEnv(): AuthEnv | null {
  const url = read("AIOS_SUPABASE_URL");
  const anon = read("SUPABASE_ANON_KEY");
  const serviceRole = read("AIOS_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !serviceRole) return null;
  return { url, anon, serviceRole };
}
