"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, KeyRound, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const inputCls = cn(
  "w-full px-3 py-2.5 rounded-lg border border-brand-200 bg-white",
  "text-sm text-ink placeholder:text-ink-subtle",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:border-brand-400",
  "disabled:bg-surface-muted disabled:cursor-not-allowed",
);
const btnCls = cn(
  "w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg",
  "bg-brand-700 text-white text-sm font-semibold hover:bg-brand-800 transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
  "disabled:opacity-50 disabled:cursor-not-allowed",
);

type Variant = "activate" | "forgot";

const COPY: Record<Variant, { title: string; intro: string }> = {
  activate: {
    title: "Account activeren",
    intro:
      "We sturen een verificatiecode naar je e-mail. Daarmee stel je je wachtwoord in.",
  },
  forgot: {
    title: "Wachtwoord vergeten",
    intro:
      "Vul je e-mailadres in; we sturen een verificatiecode waarmee je een nieuw wachtwoord instelt.",
  },
};

/**
 * Gedeelde OTP-code-flow (2 stappen: code aanvragen → code invoeren). Gebruikt
 * door /auth/verify (activate) en /auth/forgot (wachtwoord vergeten). Na een
 * geldige code stuurt 'ie door naar /auth/update-password — dezelfde engine,
 * alleen de teksten verschillen per variant.
 */
export function CodeFlow({ variant }: { variant: Variant }) {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") || "/";
  const copy = COPY[variant];

  // Diep-link vanuit de uitnodigingsmail: ?email=… → adres voorinvullen en
  // direct naar de code-stap, zodat de genodigde de code uit de mail meteen
  // kan invoeren (zonder eerst een nieuwe aan te vragen).
  const prefilledEmail = params.get("email") ?? "";
  const [step, setStep] = useState<"email" | "code">(
    prefilledEmail ? "code" : "email",
  );
  const [email, setEmail] = useState(prefilledEmail);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setStep("code"); // altijd neutraal door (geen adres-enumeratie)
    } catch {
      setError("Er ging iets mis. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), token: token.trim() }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? "Dit adres heeft geen toegang."
            : "De code is ongeldig of verlopen. Vraag een nieuwe aan.",
        );
        setBusy(false);
        return;
      }
      const data = (await res.json()) as { next?: string };
      const dest = data.next || "/auth/update-password";
      router.push(`${dest}?next=${encodeURIComponent(nextPath)}`);
      router.refresh();
    } catch {
      setError("Er ging iets mis. Probeer het opnieuw.");
      setBusy(false);
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
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-alert-50 border border-alert-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-alert-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-alert-700">{error}</p>
            </div>
          )}

          {step === "email" ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div>
                <h1 className="font-display text-xl font-semibold text-brand-700 mb-1">
                  {copy.title}
                </h1>
                <p className="text-sm text-ink-muted mb-4">{copy.intro}</p>
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
                  disabled={busy}
                  placeholder="jij@klant.nl"
                  className={inputCls}
                />
              </div>
              <button type="submit" disabled={busy || !email} className={btnCls}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Stuur code
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <h1 className="font-display text-xl font-semibold text-brand-700 mb-1">
                  Voer de code in
                </h1>
                <p className="text-sm text-ink-muted mb-4">
                  Als <span className="font-medium">{email}</span> toegang heeft,
                  staat er een code in de inbox.
                </p>
                <label htmlFor="token" className="block text-sm font-medium text-ink mb-1.5">
                  Verificatiecode
                </label>
                <input
                  id="token"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  disabled={busy}
                  placeholder="Code uit de e-mail"
                  className={cn(inputCls, "tracking-[0.3em] text-center text-lg")}
                />
              </div>
              <button type="submit" disabled={busy || token.length < 6} className={btnCls}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Verifieer code
              </button>
              <button
                type="button"
                onClick={() => { setStep("email"); setToken(""); setError(null); }}
                className="w-full text-center text-sm text-ink-muted hover:text-brand-700"
              >
                Ander e-mailadres / opnieuw versturen
              </button>
            </form>
          )}
        </div>

        <div className="text-center mt-6">
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-1 text-sm text-ink-subtle hover:text-brand-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Terug naar inloggen
          </Link>
        </div>
      </div>
    </div>
  );
}
