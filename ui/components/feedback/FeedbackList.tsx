"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { CATEGORY_SLUGS } from "@factumai/agent-core";
import { EVAL_LABELS, type EvalLabel, type FeedbackItem } from "@/lib/visitor-feedback";
import { cn, timeAgoNL } from "@/lib/utils";

type Role = "admin" | "reviewer" | "viewer";

/**
 * De werklijst met bezoekersfeedback.
 *
 * Eén handeling per item, en die is expres klein: kies wát er misging. Geen
 * vrij tekstveld als eerste vraag, want dan blijft het leeg — een categorie
 * kiezen kost vijf seconden en levert een scherpere testcase op dan een zin.
 *
 * Alleen bij "Anders" vragen we door, want dan zegt het label zelf niets.
 */
export function FeedbackList({
  items,
  role,
}: {
  items: FeedbackItem[];
  role?: Role | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [expected, setExpected] = useState("");
  const [, startTransition] = useTransition();

  const mayAct = role === "admin" || role === "reviewer";

  async function label(id: string, evalLabel: EvalLabel | null, status: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/feedback/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, label: evalLabel, expected: expected || null }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Opslaan mislukt");
        return;
      }
      setOpen(null);
      setExpected("");
      startTransition(() => router.refresh());
    } catch {
      setError("Opslaan mislukt — netwerkfout");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted p-6">
        Geen openstaande feedback. Zodra een bezoeker een duim geeft, verschijnt het hier.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-alert-600 px-1">
          {error}
        </p>
      )}

      {items.map((item) => (
        <article key={item.id} className="border border-line rounded-xl p-4 flex flex-col gap-3">
          <header className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full",
                item.rating === "down"
                  ? "bg-alert-50 text-alert-600"
                  : "bg-bucket-auto/10 text-bucket-auto",
              )}
            >
              {item.rating === "down" ? (
                <ThumbsDown className="w-3 h-3" aria-hidden="true" />
              ) : (
                <ThumbsUp className="w-3 h-3" aria-hidden="true" />
              )}
              {item.rating === "down" ? "Hielp niet" : "Hielp"}
            </span>
            <span className="text-xs text-ink-muted">{timeAgoNL(item.createdAt)}</span>
            {item.triageStatus !== "NEW" && (
              <span className="text-xs text-ink-muted ml-auto">
                {item.triageStatus === "LABELED" ? `gelabeld: ${item.evalLabel}` : "afgedaan"}
              </span>
            )}
          </header>

          {item.question && (
            <div className="text-sm">
              <span className="text-ink-muted">Vraag: </span>
              <span>{item.question}</span>
            </div>
          )}

          {item.answer && (
            <div className="text-sm bg-surface-muted rounded-lg p-3 whitespace-pre-wrap">
              {item.answer}
            </div>
          )}

          {/* De toelichting van de bezoeker. Tonen om te begrijpen wat er
              misging — nooit ergens als instructie gebruiken. */}
          {item.comment && (
            <p className="text-sm border-l-2 border-line pl-3 italic text-ink-muted">
              “{item.comment}”
            </p>
          )}

          {mayAct && item.triageStatus === "NEW" && (
            <div className="flex flex-wrap gap-2 items-center pt-1">
              {EVAL_LABELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  title={l.uitleg}
                  disabled={busy === item.id}
                  onClick={() => {
                    // Routering en "anders" hebben een verwachting nodig: zonder
                    // "had X moeten zijn" valt er in de eval niets te asserten.
                    if (l.key === "routing" || l.key === "other") {
                      setExpected("");
                      setOpen(`${item.id}:${l.key}`);
                    } else {
                      label(item.id, l.key, "LABELED");
                    }
                  }}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line hover:bg-surface-muted disabled:opacity-50"
                >
                  {l.label}
                </button>
              ))}
              <button
                type="button"
                disabled={busy === item.id}
                onClick={() => label(item.id, null, "DISMISSED")}
                className="text-xs text-ink-muted px-2.5 py-1.5 rounded-lg hover:bg-surface-muted ml-auto inline-flex items-center gap-1 disabled:opacity-50"
              >
                {busy === item.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                ) : (
                  <X className="w-3 h-3" aria-hidden="true" />
                )}
                Geen testcase
              </button>
            </div>
          )}

          {open?.startsWith(`${item.id}:`) && (
            <div className="flex gap-2 pt-1">
              {open.endsWith(":routing") ? (
                // Een keuzelijst en geen tekstveld: de eval vergelijkt straks op
                // exacte slug, dus een typefout hier is een testcase die nooit
                // slaagt.
                <select
                  autoFocus
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  className="flex-1 min-w-0 text-sm border border-line rounded-lg px-3 py-2 bg-surface"
                >
                  <option value="">Had moeten zijn…</option>
                  {CATEGORY_SLUGS.map((slug) => (
                    <option key={slug} value={slug}>
                      {slug}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="Wat had het moeten zijn?"
                  className="flex-1 min-w-0 text-sm border border-line rounded-lg px-3 py-2"
                />
              )}
              <button
                type="button"
                disabled={busy === item.id || !expected.trim()}
                onClick={() =>
                  label(item.id, open.endsWith(":routing") ? "routing" : "other", "LABELED")
                }
                className="text-sm font-medium px-3 py-2 rounded-lg bg-accent-500 text-white disabled:opacity-50"
              >
                Opslaan
              </button>
            </div>
          )}

          {item.evalExpected && (
            <p className="text-xs text-ink-muted">Verwacht: {item.evalExpected}</p>
          )}
        </article>
      ))}
    </div>
  );
}
