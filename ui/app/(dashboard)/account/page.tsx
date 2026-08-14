"use client";

import { useState } from "react";
import { Lock, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Voorkomt dat OpenNext deze "use client"-pagina probeert te prerenderen
// (waarbij de dashboard-layout serverless de auth-call al moet doen — daar
// kwamen 500's vandaan).
export const dynamic = "force-dynamic";

const inputCls = cn(
  "w-full px-3 py-2.5 rounded-lg border border-brand-200 bg-white",
  "text-sm text-ink placeholder:text-ink-subtle",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:border-brand-400",
  "disabled:bg-surface-muted disabled:cursor-not-allowed",
);

/**
 * Account-pagina voor de ingelogde gebruiker: wachtwoord wijzigen. Hergebruikt
 * het bestaande /api/auth/update-password (zet het wachtwoord voor de actieve
 * sessie). De middleware laat alleen ingelogde sessies hier.
 */
export default function AccountPage() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
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
        setError(
          res.status === 401
            ? "Je sessie is verlopen. Log opnieuw in."
            : "Kon het wachtwoord niet wijzigen. Probeer het opnieuw.",
        );
        setBusy(false);
        return;
      }
      setPw("");
      setPw2("");
      setDone(true);
    } catch {
      setError("Er ging iets mis. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-8 py-8 max-w-md">
      <h1 className="font-display text-xl font-semibold text-brand-700 mb-1">
        Account
      </h1>
      <p className="text-sm text-ink-muted mb-6">Wijzig je wachtwoord.</p>

      <div className="bg-white rounded-xl border border-brand-100 shadow-soft p-6">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-alert-50 border border-alert-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-alert-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-alert-700">{error}</p>
          </div>
        )}
        {done && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-green-700">Je wachtwoord is gewijzigd.</p>
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
  );
}
