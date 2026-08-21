/**
 * De rechten van de ingelogde gebruiker, geladen uit `aios_role_grants`.
 *
 * Bovenop `require-role.ts`, dat alleen de rol kent. Hier komt de tweede as
 * bij: in welke module mag deze rol werken, en met welke datacategorieën. De
 * logica zelf staat in agent-core (`resolveAccess`) en is daar getest — dit
 * bestand doet de query en de guard.
 *
 * Eén rechtenmodel: dezelfde rol die bepaalt wat iemand mag goedkeuren, bepaalt
 * wat hij mag zien. Geen tweede tabel met gebruikers ernaast.
 */

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import {
  categoriesAcross,
  licensedFrom,
  parseModuleSet,
  resolveAccess,
  resolveUserAccess,
  toRoleGrant,
  type DataCategory,
  type ModuleId,
  type ModuleSet,
  type ResolvedAccess,
  type Role,
  type RoleGrant,
} from "@factumai/agent-core";
import { MODULES } from "@/lib/modules";
import { cockpitEnv } from "@/lib/db";
import type { CockpitEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, type AuthedUser } from "./require-role";

export interface AuthedAccess extends AuthedUser {
  access: ResolvedAccess;
  /** De geregistreerde modules waar deze gebruiker in mag. */
  modules: ModuleId[];
  /** Categorieën over al zijn modules heen — voor schermen zonder één module. */
  categories: readonly DataCategory[];
  /** Wat de organisatie heeft afgenomen. Het plafond boven alles hierboven. */
  licensed: ModuleSet;
}

/**
 * De afname van deze tenant, uit de Worker-config.
 *
 * Niet uit de klant-database: die leeft in het Supabase-project van de klant, en
 * een plafond dat de begrensde partij zelf kan verzetten is geen plafond.
 */
export function licensedModules(env: CockpitEnv): ModuleSet {
  return parseModuleSet(env.LICENSED_MODULES);
}

/** De afgenomen modules die ook echt geregistreerd zijn (dus een scherm hebben). */
export function licensedRegisteredModules(env: CockpitEnv): ModuleId[] {
  return licensedFrom(licensedModules(env), MODULES.map((m) => m.id));
}

/**
 * Haalt de grants van deze tenant op. Faalt de query, dan geeft dit een lege
 * lijst terug en valt `resolveAccess` op het standaardvoorstel terug — een
 * cockpit die op een databasehapering niemand meer binnenlaat is een storing,
 * en de onderkant van dat voorstel lekt niets.
 */
async function loadGrants(organizationId: string): Promise<RoleGrant[]> {
  const admin = supabaseAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from("aios_role_grants")
    .select("role, module, categories")
    .eq("organization_id", organizationId);
  if (error || !data) return [];
  return (data as { role: string | null; module: string | null; categories: unknown }[])
    .map(toRoleGrant)
    .filter((g): g is RoleGrant => g !== null);
}

/** De rechten van de huidige sessie. Null als er geen (toegestane) sessie is. */
export async function getCurrentAccess(): Promise<AuthedAccess | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return accessFor(user);
}

/**
 * De rechten bij een al vastgestelde gebruiker: afname ∩ toewijzing ∩ rol.
 *
 * De doorsnede wordt op één plek uitgerekend, in `resolveUserAccess`. Zodra dit
 * op drie plekken los gebeurt, is er een plek die er één vergeet.
 */
export async function accessFor(user: AuthedUser): Promise<AuthedAccess> {
  const env = cockpitEnv();
  const grants = await loadGrants(env.AIOS_ORG_ID);
  const licensed = licensedModules(env);
  const access = resolveUserAccess(
    { role: user.role, grants, licensed, userModules: user.modules },
    resolveAccess(user.role, grants),
  );
  const modules = access.modulesFrom(MODULES.map((m) => m.id));
  return {
    ...user,
    access,
    modules,
    categories: categoriesAcross(access, modules),
    licensed,
  };
}

/**
 * Guard voor route-handlers die over **meerdere** modules lezen — de auditlog,
 * de export, straks de cijfers.
 *
 * Controleert alleen de rang; wélke modules deze gebruiker mag zien staat in
 * `modules` op het resultaat en dat is wat de caller in zijn query zet. Bewust
 * geen `requireModule` per module in een lus: een leeslijst hoort niet te
 * weigeren maar in te korten, anders krijgt iemand met één afdeling een 403 op
 * een pagina waar gewoon minder in staat.
 */
export async function requireAccess(
  minRole: Role,
): Promise<AuthedAccess | NextResponse> {
  const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, admin: 2 };
  const user = await getCurrentAccess();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (RANK[user.role] < RANK[minRole]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return user;
}

/**
 * Guard voor route-handlers die op één module werken. Controleert de rol én de
 * modulegrant, in die volgorde — een salesmedewerker die genoeg rang heeft om
 * goed te keuren, mag dat nog steeds niet in administratie.
 *
 * Geeft een NextResponse terug bij faal zodat de caller direct kan returnen.
 */
export async function requireModule(
  module: ModuleId,
  minRole: Role,
): Promise<AuthedAccess | NextResponse> {
  const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, admin: 2 };
  const user = await getCurrentAccess();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (RANK[user.role] < RANK[minRole]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!user.access.mayEnter(module)) {
    // Bewust dezelfde 403 als een rangfout, met een reden erbij voor de
    // logs — maar zonder te verklappen wát er in die module ligt.
    return NextResponse.json(
      { error: "Forbidden", reason: "module" },
      { status: 403 },
    );
  }
  return user;
}

/**
 * Dezelfde guard, maar voor een **pagina** in plaats van een route-handler.
 *
 * Een server-component kan geen `NextResponse` teruggeven, dus de uitkomst is
 * hier een redirect naar de werkbak. Die toont precies wat deze gebruiker wél
 * mag, in plaats van een foutpagina die vooral verklapt dát er iets is.
 *
 * Waarom dit naast de tabfilter in de werkbak moet: die verbérgt een module, en
 * verbergen is niet weigeren. Zonder deze guard is een moduletab-scherm gewoon
 * bereikbaar door de URL in te tikken — ook voor iemand die die afdeling niet
 * heeft afgenomen. De zijbalk is cosmetica; dit is de grens.
 *
 * Bij faal keert hij nooit terug (`redirect` gooit), dus de aanroeper mag de
 * teruggegeven gebruiker zonder verdere controle gebruiken.
 */
export async function requireModulePage(
  module: ModuleId,
  minRole: Role = "viewer",
): Promise<AuthedAccess> {
  const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, admin: 2 };
  const user = await getCurrentAccess();
  // Geen sessie hoort de middleware al af te vangen; komt het toch hier, dan is
  // aanmelden het juiste antwoord en niet een lege werkbak.
  if (!user) redirect("/sign-in");
  if (RANK[user.role] < RANK[minRole] || !user.access.mayEnter(module)) {
    redirect("/");
  }
  return user;
}
