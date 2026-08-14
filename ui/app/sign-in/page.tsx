"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") || "/";
  const errorCode = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState<string | null>(
    errorCode === "config"
      ? "Auth is nog niet geconfigureerd. Zet SUPABASE_ANON_KEY op de cockpit-Worker."
      : null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? "Dit adres heeft geen toegang. Vraag een beheerder om een uitnodiging."
            : "E-mailadres of wachtwoord klopt niet.",
        );
        setStatus("idle");
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Er ging iets mis. Probeer het opnieuw.");
      setStatus("idle");
    }
  }

  return (
    <div className="min-h-screen bg-surface-muted flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-baseline justify-center gap-0 text-3xl font-display font-bold mb-2">
            <span className="italic text-accent-500">sun</span>
            <span className="text-brand-700">wise</span>
          </div>
          <div className="text-sm text-ink-muted">Cockpit</div>
        </div>

        <div className="bg-white rounded-xl border border-brand-100 shadow-soft p-6 sm:p-8">
          <h1 className="font-display text-xl font-semibold text-brand-700 mb-1">
            Inloggen
          </h1>
          <p className="text-sm text-ink-muted mb-6">
            Log in met je e-mailadres en wachtwoord.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-alert-50 border border-alert-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-alert-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-alert-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink mb-1.5">
                E-mailadres
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "submitting"}
                placeholder="jij@klant.nl"
                className={cn(
                  "w-full px-3 py-2.5 rounded-lg border border-brand-200 bg-white",
                  "text-sm text-ink placeholder:text-ink-subtle",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:border-brand-400",
                  "disabled:bg-surface-muted disabled:cursor-not-allowed",
                )}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink mb-1.5">
                Wachtwoord
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={status === "submitting"}
                placeholder="••••••••"
                className={cn(
                  "w-full px-3 py-2.5 rounded-lg border border-brand-200 bg-white",
                  "text-sm text-ink placeholder:text-ink-subtle",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:border-brand-400",
                  "disabled:bg-surface-muted disabled:cursor-not-allowed",
                )}
              />
            </div>

            <button
              type="submit"
              disabled={status === "submitting" || !email || !password}
              className={cn(
                "w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg",
                "bg-brand-700 text-white text-sm font-semibold",
                "hover:bg-brand-800 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {status === "submitting" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Inloggen...
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  Inloggen
                </>
              )}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-brand-100 text-center space-y-2">
            <Link
              href={`/auth/forgot?next=${encodeURIComponent(nextPath)}`}
              className="block text-sm text-brand-600 hover:text-brand-800 underline underline-offset-2"
            >
              Wachtwoord vergeten?
            </Link>
            <Link
              href={`/auth/verify?next=${encodeURIComponent(nextPath)}`}
              className="block text-sm text-ink-muted hover:text-brand-700"
            >
              Eerste keer hier? Account activeren
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-ink-subtle mt-6">
          Alleen genodigde adressen kunnen inloggen.
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface-muted flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
