"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Role = "admin" | "reviewer" | "viewer";

interface AllowedUser {
  email: string;
  role: Role;
  invited_by: string | null;
  created_at: string;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

const ROLE_BADGE: Record<Role, string> = {
  admin: "bg-brand-50 text-brand-700 border-brand-200",
  reviewer: "bg-blue-50 text-blue-700 border-blue-200",
  viewer: "bg-surface-muted text-ink-muted border-brand-100",
};

export function UserTable({
  initialUsers,
  currentEmail,
}: {
  initialUsers: AllowedUser[];
  currentEmail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Invite-form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("reviewer");
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const addr = email.trim().toLowerCase();
    if (!addr.includes("@")) {
      setError("Voer een geldig e-mailadres in.");
      return;
    }
    setInviting(true);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr, role }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "uitnodigen mislukt");
      }
      setEmail("");
      setNotice(`Uitnodiging verstuurd naar ${addr} (rol ${ROLE_LABEL[role]}).`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "uitnodigen mislukt");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(target: string, nextRole: Role) {
    setError(null);
    setNotice(null);
    setBusyEmail(target);
    try {
      const res = await fetch(
        `/api/admin/allowed-emails/${encodeURIComponent(target)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: nextRole }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "wijzigen mislukt");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "wijzigen mislukt");
    } finally {
      setBusyEmail(null);
    }
  }

  async function remove(target: string) {
    if (!confirm(`Toegang voor ${target} intrekken?`)) return;
    setError(null);
    setNotice(null);
    setBusyEmail(target);
    try {
      const res = await fetch(
        `/api/admin/allowed-emails/${encodeURIComponent(target)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "verwijderen mislukt");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "verwijderen mislukt");
    } finally {
      setBusyEmail(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Uitnodigen */}
      <div className="rounded-xl border border-brand-100 bg-white shadow-soft p-4 sm:p-5">
        <h3 className="text-sm font-medium text-ink mb-3 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-brand-500" />
          Gebruiker uitnodigen
        </h3>
        <form onSubmit={invite} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="collega@klant.nl"
            className="flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="rounded-lg border border-brand-200 px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <option value="reviewer">Reviewer</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={inviting}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
              "bg-brand-600 text-white hover:bg-brand-700 transition-colors",
              "disabled:opacity-60 disabled:cursor-not-allowed",
            )}
          >
            {inviting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            Uitnodigen
          </button>
        </form>
        <p className="text-xs text-ink-subtle mt-2">
          De genodigde krijgt een e-mail met een code om in te loggen en een
          wachtwoord in te stellen.
        </p>
      </div>

      {(error || notice) && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            error
              ? "bg-alert-50 text-alert-700 border border-alert-200"
              : "bg-green-50 text-green-700 border border-green-200",
          )}
        >
          {error ?? notice}
        </div>
      )}

      {/* Lijst */}
      <div className="rounded-xl border border-brand-100 bg-white shadow-soft overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-brand-100 bg-surface-muted/50">
          <ShieldCheck className="w-4 h-4 text-brand-500" />
          <h3 className="text-xs font-medium text-ink-muted uppercase tracking-wide">
            Toegang ({initialUsers.length})
          </h3>
        </div>
        <div className="divide-y divide-brand-50">
          {initialUsers.length === 0 && (
            <div className="px-4 py-6 text-sm text-ink-subtle">
              Nog geen gebruikers op de allowlist.
            </div>
          )}
          {initialUsers.map((u) => {
            const isSelf = u.email === currentEmail;
            const busy = busyEmail === u.email || pending;
            return (
              <div
                key={u.email}
                className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink font-medium truncate flex items-center gap-2">
                    {u.email}
                    {isSelf && (
                      <span className="text-[10px] uppercase tracking-wide text-ink-subtle">
                        (jij)
                      </span>
                    )}
                  </div>
                </div>

                <span
                  className={cn(
                    "inline-flex sm:hidden items-center px-2 py-0.5 rounded-full text-xs font-medium border w-fit",
                    ROLE_BADGE[u.role],
                  )}
                >
                  {ROLE_LABEL[u.role]}
                </span>

                <div className="flex items-center gap-2">
                  <select
                    value={u.role}
                    disabled={busy || isSelf}
                    onChange={(e) => changeRole(u.email, e.target.value as Role)}
                    className={cn(
                      "rounded-lg border border-brand-200 px-2.5 py-1.5 text-sm bg-white",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                      "disabled:opacity-60 disabled:cursor-not-allowed",
                    )}
                    title={isSelf ? "Je eigen rol kun je niet wijzigen" : undefined}
                  >
                    <option value="admin">Admin</option>
                    <option value="reviewer">Reviewer</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => remove(u.email)}
                    disabled={busy || isSelf}
                    title={isSelf ? "Je kunt jezelf niet verwijderen" : "Toegang intrekken"}
                    className={cn(
                      "inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors",
                      "border-alert-200 text-alert-600 hover:bg-alert-50",
                      "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                    )}
                  >
                    {busyEmail === u.email ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
