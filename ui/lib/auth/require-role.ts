import { NextResponse } from "next/server";
import {
  allowlistKeysFor,
  normalizeEmail,
  resolveAllowlistEntry,
  type AllowlistRow,
  type Role,
} from "@factumai/agent-core";
import { supabaseFromCookies, supabaseAdmin } from "@/lib/supabase/server";

export type { Role };

const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, admin: 2 };

export interface AuthedUser {
  email: string;
  role: Role;
  /**
   * Afdelingen waarin deze gebruiker werkt, ruw uit `allowed_emails.modules`.
   * `["*"]` = alles wat de organisatie heeft afgenomen — nooit meer. De
   * doorsnede met de afname en de rolgrant wordt in `access.ts` gemaakt.
   */
  modules: string[];
}

/**
 * Rol van de huidige sessie o.b.v. `allowed_emails`. Null als er geen sessie is,
 * geen e-mail bekend is, of het adres niet (meer) op de allowlist staat.
 */
export async function getCurrentUser(): Promise<AuthedUser | null> {
  const supabase = await supabaseFromCookies();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!email) return null;

  return resolveRole(email);
}

/**
 * Zoekt de rol bij een (al geverifieerd) e-mailadres.
 *
 * Haalt in één query zowel de persoonlijke regel als de domeinregel op
 * (`jan@klant.nl` en `@klant.nl`); welke van de twee wint, beslist
 * `resolveRoleFromRows` in agent-core — daar staan ook de tests.
 */
export async function resolveRole(email: string): Promise<AuthedUser | null> {
  const admin = supabaseAdmin();
  if (!admin) return null;
  const normalized = normalizeEmail(email);
  const { data, error } = await admin
    .from("allowed_emails")
    .select("email, role, modules")
    .in("email", allowlistKeysFor(normalized));
  if (error || !data) return null;

  const entry = resolveAllowlistEntry(normalized, data as AllowlistRow[]);
  return entry ? { email: normalized, role: entry.role, modules: entry.modules } : null;
}

/**
 * Guard voor route-handlers. Geeft een NextResponse terug bij faal zodat de
 * caller direct kan returnen; bij succes een `AuthedUser`.
 */
export async function requireRole(
  minRole: Role,
): Promise<AuthedUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (RANK[user.role] < RANK[minRole]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return user;
}
