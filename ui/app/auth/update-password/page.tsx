"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandHeader } from "@/components/BrandMark";

const inputCls = cn(
  "w-full px-3 py-2.5 rounded-lg border border-brand-200 bg-white",
  "text-sm text-ink placeholder:text-ink-subtle",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:border-brand-400",
  "disabled:bg-surface-muted disabled:cursor-not-allowed",
);

function UpdatePasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") || "/";

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) {
      setError("Kies een wachtwoord van minstens 10 tekens.");
      return;
    }
    if (pw !== pw2) {
      setError("De wachtwoorden komen niet overeen.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        const baseline =
          res.status === 401
            ? "Je sessie is verlopen. Vraag een nieuwe code aan."
            : res.status === 403
              ? "Dit adres heeft geen toegang."
              : "Kon het wachtwoord niet instellen. Probeer het opnieuw.";
        setError(body.message ? `${baseline} (${body.message})` : baseline);
        setBusy(false);
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Er ging iets mis. Probeer het opnieuw.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-muted flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <BrandHeader />

        <div className="bg-white rounded-xl border border-brand-100 shadow-soft p-6 sm:p-8">
          <h1 className="font-display text-xl font-semibold text-brand-700 mb-1">
            Wachtwoord instellen
          </h1>
          <p className="text-sm text-ink-muted mb-6">
            Kies een wachtwoord waarmee je voortaan inlogt.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-alert-50 border border-alert-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-alert-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-alert-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="pw" className="block text-sm font-medium text-ink mb-1.5">
                Nieuw wachtwoord
              </label>
              <input
                id="pw"
                type="password"
                required
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                disabled={busy}
                placeholder="Minstens 10 tekens"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="pw2" className="block text-sm font-medium text-ink mb-1.5">
                Herhaal wachtwoord
              </label>
              <input
                id="pw2"
                type="password"
                required
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                disabled={busy}
                placeholder="••••••••"
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={busy || !pw || !pw2}
              className={cn(
                "w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg",
                "bg-brand-700 text-white text-sm font-semibold hover:bg-brand-800 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Wachtwoord opslaan
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function UpdatePasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface-muted flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      }
    >
      <UpdatePasswordForm />
    </Suspense>
  );
}
