import { NextResponse } from "next/server";
import { supabaseFromCookies, supabaseAdmin } from "@/lib/supabase/server";

export type Role = "admin" | "reviewer" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, admin: 2 };

export interface AuthedUser {
  email: string;
  role: Role;
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

/** Zoekt de rol bij een (al geverifieerd) e-mailadres. */
export async function resolveRole(email: string): Promise<AuthedUser | null> {
  const admin = supabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from("allowed_emails")
    .select("role")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  const role = (data.role as Role) ?? "reviewer";
  return { email: email.toLowerCase(), role };
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
