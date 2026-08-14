"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DemoScenario } from "@/lib/demo/scenarios";

interface DemoPanelProps {
  scenarios: readonly DemoScenario[];
}

type Status =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

/**
 * Bedieningspaneel voor de demo. Je kiest welke mails je wilt tonen en zet ze
 * op de work-bus; de agent doet de rest en de werkbak vult zich vanzelf.
 *
 * Bewust géén "fake" resultaten: wat de prospect ziet is wat de agent echt
 * produceert op deze mails.
 */
export function DemoPanel({ scenarios }: DemoPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"seed" | "reset" | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [selected, setSelected] = useState<string[]>(
    scenarios.map((s) => s.key),
  );

  const allSelected = selected.length === scenarios.length;

  function toggle(key: string) {
    setSelected((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
  }

  async function run(action: "seed" | "reset") {
    setBusy(action);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/demo", {
        method: action === "seed" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: action === "seed" ? JSON.stringify({ keys: selected }) : undefined,
      });
      const data = (await res.json()) as {
        error?: string;
        seeded?: string[];
        skipped?: string[];
        removed?: number;
      };
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "Actie mislukt" });
        return;
      }
      if (action === "seed") {
        const n = data.seeded?.length ?? 0;
        const skipped = data.skipped?.length ?? 0;
        setStatus({
          kind: "ok",
          message:
            n === 0
              ? "Alle gekozen mails stonden er al — de agent verwerkt ze of is klaar."
              : `${n} mail${n === 1 ? "" : "s"} op de bus gezet${
                  skipped > 0 ? `, ${skipped} stond${skipped === 1 ? "" : "en"} er al` : ""
                }. De agent verwerkt ze nu; de werkbak vult zich binnen een minuut.`,
        });
      } else {
        setStatus({
          kind: "ok",
          message: `${data.removed ?? 0} demo-item${data.removed === 1 ? "" : "s"} opgeruimd.`,
        });
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run("seed")}
          disabled={busy !== null || selected.length === 0}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
            "bg-accent-500 text-white hover:bg-accent-600 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {busy === "seed" ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="w-4 h-4" aria-hidden="true" />
          )}
          Start demo ({selected.length})
        </button>

        <button
          type="button"
          onClick={() => run("reset")}
          disabled={busy !== null}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
            "border border-brand-200 text-ink-muted hover:bg-brand-50 transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {busy === "reset" ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          )}
          Demo opruimen
        </button>

        <button
          type="button"
          onClick={() =>
            setSelected(allSelected ? [] : scenarios.map((s) => s.key))
          }
          className="text-sm text-ink-subtle hover:text-brand-700 underline underline-offset-2"
        >
          {allSelected ? "Niets selecteren" : "Alles selecteren"}
        </button>
      </div>

      {status.kind !== "idle" && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
            status.kind === "ok"
              ? "bg-green-50 text-green-800"
              : "bg-alert-50 text-alert-700",
          )}
        >
          {status.kind === "ok" ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          )}
          <span>{status.message}</span>
        </div>
      )}

      <ul className="space-y-2">
        {scenarios.map((s) => {
          const on = selected.includes(s.key);
          return (
            <li key={s.key}>
              <label
                className={cn(
                  "flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                  on
                    ? "border-accent-300 bg-accent-50/40"
                    : "border-brand-100 hover:bg-brand-50/50",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(s.key)}
                  className="mt-1 flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink truncate">
                    {s.subject}
                  </div>
                  <div className="text-xs text-ink-subtle mt-0.5">
                    {s.fromName} &lt;{s.from}&gt;
                  </div>
                  <p className="text-xs text-ink-muted mt-1.5">{s.purpose}</p>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      {pending && (
        <p className="text-xs text-ink-subtle">Werkbak verversen…</p>
      )}
    </div>
  );
}
