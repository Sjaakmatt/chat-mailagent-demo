import { ShieldAlert, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/require-role";
import { supabaseAdmin } from "@/lib/supabase/server";
import { UserTable } from "@/components/admin/UserTable";
import { RoleGrantMatrix } from "@/components/admin/RoleGrantMatrix";
import { toRoleGrant, type RoleGrant } from "@factumai/agent-core";
import { cockpitEnv } from "@/lib/db";
import { licensedRegisteredModules } from "@/lib/auth/access";
import { MODULES } from "@/lib/modules";

export const dynamic = "force-dynamic";

type Role = "admin" | "reviewer" | "viewer";

interface AllowedUser {
  email: string;
  role: Role;
  modules: string[] | null;
  invited_by: string | null;
  created_at: string;
}

export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== "admin") {
    return (
      <>
        <PageHeader />
        <div className="flex-1 flex items-center justify-center p-12">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 rounded-full bg-alert-50 flex items-center justify-center mx-auto mb-3">
              <ShieldAlert className="w-7 h-7 text-alert-500" />
            </div>
            <h2 className="font-display text-lg font-semibold text-brand-700 mb-1">
              Geen toegang
            </h2>
            <p className="text-ink-muted text-sm">
              Alleen beheerders kunnen toegang beheren.
            </p>
          </div>
        </div>
      </>
    );
  }

  let users: AllowedUser[] = [];
  const admin = supabaseAdmin();
  if (admin) {
    const { data } = await admin
      .from("allowed_emails")
      .select("email, role, modules, invited_by, created_at")
      .order("created_at", { ascending: true });
    users = (data as AllowedUser[] | null) ?? [];
  }

  // Rechten per rol. Geen rijen = het standaardvoorstel uit agent-core; dat
  // zeggen we erbij, want "leeg" en "bewust zo ingesteld" zien er anders
  // identiek uit.
  let grants: RoleGrant[] = [];
  if (admin) {
    const { data } = await admin
      .from("aios_role_grants")
      .select("role, module, categories")
      .eq("organization_id", cockpitEnv().AIOS_ORG_ID);
    grants = ((data as { role: string | null; module: string | null; categories: unknown }[] | null) ?? [])
      .map(toRoleGrant)
      .filter((g): g is RoleGrant => g !== null);
  }

  // Alleen wat deze organisatie heeft afgenomen én waar code voor bestaat. Wij
  // verkopen per afdeling; een beheerder bij de klant kan zichzelf niets erbij
  // geven, en de API weigert het ook.
  const licensedIds = licensedRegisteredModules(cockpitEnv());
  const licensed = MODULES.filter((m) => licensedIds.includes(m.id)).map((m) => ({
    id: m.id,
    label: m.label,
  }));

  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto p-4 sm:p-6">
          <UserTable
            initialUsers={users}
            currentEmail={user.email}
            licensed={licensed}
          />
          <RoleGrantMatrix
            grants={grants}
            usingDefaults={grants.length === 0}
            modules={licensed}
          />
        </div>
      </div>
    </>
  );
}

function PageHeader() {
  return (
    <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
      <h1 className="font-display text-2xl font-semibold text-brand-700 leading-tight flex items-center gap-2">
        <ShieldCheck className="w-6 h-6 text-brand-500" />
        Toegang
      </h1>
      <p className="text-sm text-ink-muted mt-1">
        Beheer wie de werkbak mag gebruiken en met welke rol.
      </p>
    </div>
  );
}
