"use client";

import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Het raadpleegvenster naast het werk. Eén invoerveld, geen tweede.
 *
 * Twee dingen zijn bewust zichtbaar en niet weggeklapt:
 *
 *   de bronnen  — wat de assistent heeft ingezien, met een link erheen. Een
 *                 antwoord dat je niet kunt narekenen is niet bruikbaar in een
 *                 gesprek met een klant.
 *   de weigering — als de assistent iets niet kan herleiden, staat er wát er
 *                 mis is en niet het afgekeurde antwoord. Half tonen is
 *                 gevaarlijker dan niet tonen: de helft die klopt maakt de
 *                 helft die niet klopt geloofwaardig.
 *
 * De knop heet "Vraag" en niet "Doe". De assistent voert niets uit.
 */

interface Bron {
  id: string;
  kind: string;
  label: string;
  href: string | null;
}

interface GroundingRef {
  statement: string;
  sourceId: string;
  sourceLabel: string;
}

type Antwoord =
  | { ok: true; answer: string; grounding: GroundingRef[]; gebruikteBronnen: string[]; bronnen: Bron[] }
  | { ok: false; reason: string; message: string; bronnen: Bron[] };

const VOORBEELDEN = [
  "Waarom stelt hij dit voor?",
  "Wat is de geschiedenis van deze klant?",
  "Welk beleid geldt hier?",
  "Is dit eerder voorgekomen?",
];

export function AssistantPanel({ reviewItemId }: { reviewItemId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Antwoord | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(vraag: string) {
    const trimmed = vraag.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewItemId, question: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "De assistent kon de vraag niet verwerken.");
        return;
      }
      setResult((await res.json()) as Antwoord);
    } catch {
      setError("Geen verbinding met de assistent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-lg border border-brand-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-100 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-brand-500" aria-hidden="true" />
        <h2 className="text-sm font-medium text-ink">Assistent</h2>
        <span className="text-xs text-ink-subtle">
          leest mee — voert niets uit
        </span>
      </div>

      <div className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          className="flex gap-2"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Stel een vraag over dit voorstel…"
            maxLength={1000}
            disabled={busy}
            className="flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:bg-surface-muted"
          />
          <button
            type="submit"
            disabled={busy || question.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:hover:bg-brand-600"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            Vraag
          </button>
        </form>

        {!result && !busy && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {VOORBEELDEN.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setQuestion(v);
                  void ask(v);
                }}
                className="px-2.5 py-1 rounded-full text-xs text-ink-muted border border-brand-200 bg-white hover:border-brand-400 hover:text-ink transition-colors"
              >
                {v}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm text-alert-700 bg-alert-50 border border-alert-200 rounded px-3 py-2">
            {error}
          </p>
        )}

        {result && !result.ok && (
          <div className="mt-4 flex items-start gap-2 text-sm text-ink border border-brand-100 bg-surface-muted rounded px-3 py-2">
            <AlertTriangle
              className="w-4 h-4 flex-shrink-0 mt-0.5 text-accent-500"
              aria-hidden="true"
            />
            <p>{result.message}</p>
          </div>
        )}

        {result?.ok && (
          <div className="mt-4">
            <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">
              {result.answer}
            </p>

            {result.grounding.length > 0 && (
              <ul className="mt-3 space-y-1">
                {result.grounding.map((g, i) => (
                  <li key={`${g.sourceId}-${i}`} className="text-xs text-ink-muted">
                    <span className="text-ink-subtle">↳</span> {g.statement} —{" "}
                    <span className="text-brand-700">{g.sourceLabel}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {result && result.bronnen.length > 0 && (
          <Bronnen
            bronnen={result.bronnen}
            gebruikt={result.ok ? result.gebruikteBronnen : []}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Wat de assistent heeft ingezien. Standaard zichtbaar, niet uitklapbaar —
 * een medewerker die een getal doorgeeft aan een klant moet kunnen zien waar
 * het vandaan komt zonder ergens op te moeten klikken.
 */
function Bronnen({ bronnen, gebruikt }: { bronnen: Bron[]; gebruikt: string[] }) {
  return (
    <div className="mt-4 pt-3 border-t border-brand-50">
      <p className="text-xs text-ink-subtle mb-1.5">
        Ingezien ({bronnen.length})
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {bronnen.map((b) => {
          const used = gebruikt.includes(b.id);
          const inner = (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border",
                used
                  ? "text-brand-800 border-brand-300 bg-brand-50"
                  : "text-ink-subtle border-brand-100 bg-white",
              )}
              title={used ? "Gebruikt in dit antwoord" : "Ingezien, niet geciteerd"}
            >
              {b.label}
              {b.href && <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />}
            </span>
          );
          return (
            <li key={b.id}>
              {b.href ? <Link href={b.href}>{inner}</Link> : inner}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
