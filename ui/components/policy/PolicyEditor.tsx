"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Save, Power, Package, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PolicyRuleRow } from "@/lib/db";
import { CATEGORY_SLUGS } from "@factumai/agent-core";

// Uit de gedeelde taxonomie (agent-core) — dezelfde slugs waarop de agent
// classificeert, zodat je nooit een regel kunt maken die nooit matcht.
const CATEGORIES = [...CATEGORY_SLUGS];

const ACTIONS: { value: string; label: string }[] = [
  { value: "review_queue", label: "Naar review" },
  { value: "auto_send", label: "Auto-send (blijft review)" },
  { value: "escalate", label: "Escaleren" },
  { value: "no_reply", label: "Geen antwoord" },
];

interface Draft {
  id: string | null;
  name: string;
  description: string;
  appliesTo: string[];
  responseDirective: string;
  priority: number;
  enabled: boolean;
  action: string;
  createsTask: boolean;
}

function toDraft(r: PolicyRuleRow): Draft {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    appliesTo: r.applies_to ?? [],
    responseDirective: r.response_directive ?? "",
    priority: r.priority,
    enabled: r.enabled,
    action: r.action,
    createsTask: r.creates_task,
  };
}

const BLANK: Draft = {
  id: null,
  name: "",
  description: "",
  appliesTo: [],
  responseDirective: "",
  priority: 100,
  enabled: true,
  action: "review_queue",
  createsTask: false,
};

interface PolicyEditorProps {
  initialRules: PolicyRuleRow[];
  /**
   * Fase 5C: toont de "Push naar prod"-knop naast Opslaan/Verwijderen. Alleen
   * true op staging-cockpits met AIOS_PARENT_ORG_ID gezet. Gecontroleerd
   * server-side in de `/api/policy/rules/[id]/promote`-endpoint zodat een
   * prod-cockpit die per ongeluk true krijgt tóch niet kan promoten.
   */
  promoteEnabled?: boolean;
}

export function PolicyEditor({
  initialRules,
  promoteEnabled = false,
}: PolicyEditorProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function selectRule(r: PolicyRuleRow) {
    setError(null);
    setDraft(toDraft(r));
  }
  function newRule() {
    setError(null);
    setDraft({ ...BLANK });
  }
  function patch(p: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }
  function toggleCategory(cat: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            appliesTo: d.appliesTo.includes(cat)
              ? d.appliesTo.filter((c) => c !== cat)
              : [...d.appliesTo, cat],
          }
        : d,
    );
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Naam is verplicht.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isUpdate = Boolean(draft.id);
      const url = isUpdate
        ? `/api/policy/rules/${encodeURIComponent(draft.id as string)}`
        : "/api/policy/rules";
      const res = await fetch(url, {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description,
          appliesTo: draft.appliesTo,
          responseDirective: draft.responseDirective,
          priority: draft.priority,
          enabled: draft.enabled,
          action: draft.action,
          createsTask: draft.createsTask,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "opslaan mislukt");
      }
      setDraft(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function promote() {
    if (!draft?.id) return;
    // Wijzigingen in de draft zijn niet zichtbaar op prod tot je eerst
    // opslaat — voorkomen dat de reviewer denkt dat 'ie z'n edits meepromote.
    if (
      !confirm(
        `"${draft.name}" naar prod pushen?\n\n` +
          `Werkt de rule in de klant-org bij (of maakt 'm aan als 'ie er ` +
          `nog niet is). Sla eerst je wijzigingen op als je die wilt ` +
          `meesturen.`,
      )
    ) {
      return;
    }
    setPromoting(true);
    setError(null);
    setPromoted(null);
    try {
      const res = await fetch(
        `/api/policy/rules/${encodeURIComponent(draft.id)}/promote`,
        { method: "POST" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "promote_failed");
      }
      const j = (await res.json()) as {
        action: "created" | "updated";
        parentRuleId: string;
      };
      setPromoted(
        j.action === "updated"
          ? `Bestaande prod-rule bijgewerkt (${j.parentRuleId}).`
          : `Nieuwe prod-rule aangemaakt (${j.parentRuleId}).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "promote_failed");
    } finally {
      setPromoting(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    if (!confirm(`Regel "${draft.name}" verwijderen?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/policy/rules/${encodeURIComponent(draft.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("verwijderen mislukt");
      setDraft(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "verwijderen mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Lijst */}
      <div className="lg:col-span-2 space-y-3">
        <button
          type="button"
          onClick={newRule}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-dashed border-brand-300 px-3 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nieuwe regel
        </button>

        <div className="rounded-xl border border-brand-100 bg-white shadow-soft divide-y divide-brand-50 overflow-hidden">
          {initialRules.length === 0 && (
            <div className="px-4 py-6 text-sm text-ink-subtle">
              Nog geen beleidsregels.
            </div>
          )}
          {initialRules.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => selectRule(r)}
              className={cn(
                "w-full text-left px-4 py-3 transition-colors",
                draft?.id === r.id
                  ? "bg-brand-50"
                  : "hover:bg-surface-muted/60",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-ink-subtle w-7">
                  {r.priority}
                </span>
                <span className="text-sm text-ink font-medium truncate flex-1">
                  {r.name}
                </span>
                {!r.enabled && (
                  <span className="text-[10px] uppercase tracking-wide text-ink-subtle">
                    uit
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-subtle truncate mt-0.5 pl-9">
                {(r.applies_to ?? []).join(", ") || "—"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="lg:col-span-3">
        {!draft ? (
          <div className="rounded-xl border border-brand-100 bg-white shadow-soft p-8 text-center text-sm text-ink-subtle">
            Kies een regel om te bewerken, of maak een nieuwe.
          </div>
        ) : (
          <div className="rounded-xl border border-brand-100 bg-white shadow-soft p-5 space-y-4">
            <Field label="Naam">
              <input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </Field>

            <Field label="Omschrijving (intern)">
              <textarea
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </Field>

            <Field label="Categorieën (waarop deze regel matcht)">
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((cat) => {
                  const on = draft.appliesTo.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                        on
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-white text-ink-muted border-brand-200 hover:border-brand-400",
                      )}
                    >
                      {cat.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Response-richtlijn (instructie aan de agent)">
              <textarea
                value={draft.responseDirective}
                onChange={(e) => patch({ responseDirective: e.target.value })}
                rows={5}
                placeholder="Bv. Bied excuses, vraag om een foto van de paklijst…"
                className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Prioriteit (lager = eerder)">
                <input
                  type="number"
                  value={draft.priority}
                  onChange={(e) => patch({ priority: Number(e.target.value) })}
                  className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                />
              </Field>
              <Field label="Actie (adviserend)">
                <select
                  value={draft.action}
                  onChange={(e) => patch({ action: e.target.value })}
                  className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => patch({ enabled: !draft.enabled })}
                className={cn(
                  "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                  draft.enabled
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-surface-muted text-ink-muted border-brand-100",
                )}
              >
                <Power className="w-4 h-4" />
                {draft.enabled ? "Actief" : "Uitgeschakeld"}
              </button>
              <button
                type="button"
                onClick={() => patch({ createsTask: !draft.createsTask })}
                title="Maakt bij approve een verzendtaak aan in het magazijn"
                className={cn(
                  "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                  draft.createsTask
                    ? "bg-brand-50 text-brand-700 border-brand-200"
                    : "bg-surface-muted text-ink-muted border-brand-100",
                )}
              >
                <Package className="w-4 h-4" />
                {draft.createsTask ? "Maakt vervolgtaak" : "Geen vervolgtaak"}
              </button>
            </div>

            {error && (
              <div className="rounded-lg bg-alert-50 border border-alert-200 px-3 py-2 text-sm text-alert-700">
                {error}
              </div>
            )}

            {promoted && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
                {promoted}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-brand-50">
              <button
                type="button"
                onClick={remove}
                disabled={!draft.id || saving || promoting}
                className="inline-flex items-center gap-2 rounded-lg border border-alert-200 text-alert-600 px-3 py-2 text-sm font-medium hover:bg-alert-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                Verwijderen
              </button>
              <div className="flex items-center gap-2">
                {promoteEnabled && draft.id && (
                  <button
                    type="button"
                    onClick={promote}
                    disabled={saving || promoting}
                    title="Kopieer de opgeslagen versie van deze rule naar de prod-org (klant)."
                    className="inline-flex items-center gap-2 rounded-lg border border-accent-300 text-accent-700 px-3 py-2 text-sm font-medium hover:bg-accent-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {promoting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Rocket className="w-4 h-4" />
                    )}
                    Push naar prod
                  </button>
                )}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || promoting}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Opslaan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-muted uppercase tracking-wide mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
