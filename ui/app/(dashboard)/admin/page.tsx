import { ShieldAlert, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/require-role";
import { supabaseAdmin } from "@/lib/supabase/server";
import { UserTable } from "@/components/admin/UserTable";

export const dynamic = "force-dynamic";

type Role = "admin" | "reviewer" | "viewer";

interface AllowedUser {
  email: string;
  role: Role;
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
      .select("email, role, invited_by, created_at")
      .order("created_at", { ascending: true });
    users = (data as AllowedUser[] | null) ?? [];
  }

  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto p-4 sm:p-6">
          <UserTable initialUsers={users} currentEmail={user.email} />
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
