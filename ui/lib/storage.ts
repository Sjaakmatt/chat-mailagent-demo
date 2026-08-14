import type { CockpitEnv } from "./env";

const BUCKET = "mail-attachments";

/**
 * Maakt een tijdelijke signed URL voor een object in de (private) attachments-
 * bucket. Gebruikt de service-role (server-only). Geeft null bij een fout zodat
 * de UI gewoon een niet-klikbare bijlage toont i.p.v. te crashen.
 */
export async function signAttachmentUrl(
  env: CockpitEnv,
  path: string,
  expiresIn = 3600,
): Promise<string | null> {
  try {
    const base = env.AIOS_SUPABASE_URL.replace(/\/$/, "");
    const res = await fetch(
      `${base}/storage/v1/object/sign/${BUCKET}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AIOS_SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { signedURL?: string };
    if (!json.signedURL) return null;
    return `${base}/storage/v1${json.signedURL}`;
  } catch {
    return null;
  }
}
