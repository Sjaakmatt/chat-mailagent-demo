"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Save, X, Boxes, Tag } from "lucide-react";
import type { PartBatchRow } from "@/lib/db";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function isActive(b: PartBatchRow): boolean {
  const t = today();
  return b.start_date <= t && (b.end_date === null || b.end_date >= t);
}

interface Draft {
  id: string | null;
  sku: string;
  label: string;
  color: string;
  category: string;
  startDate: string;
  endDate: string;
  notes: string;
}

function toDraft(b: PartBatchRow): Draft {
  return {
    id: b.id,
    sku: b.sku,
    label: b.label,
    color: b.color,
    category: b.category ?? "",
    startDate: b.start_date,
    endDate: b.end_date ?? "",
    notes: b.notes ?? "",
  };
}

function blank(sku = ""): Draft {
  return {
    id: null,
    sku,
    label: "",
    color: "#7c3aed",
    category: "",
    startDate: today(),
    endDate: "",
    notes: "",
  };
}

export function BatchEditor({ initialBatches }: { initialBatches: PartBatchRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  async function save() {
    if (!draft) return;
    if (!draft.sku.trim() || !draft.label.trim() || !draft.startDate) {
      setError("SKU, label en startdatum zijn verplicht.");
      return;
    }
    if (draft.endDate && draft.endDate < draft.startDate) {
      setError("Einddatum ligt vóór de startdatum.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isUpdate = Boolean(draft.id);
      const res = await fetch(
        isUpdate ? `/api/batches/${encodeURIComponent(draft.id as string)}` : "/api/batches",
        {
          method: isUpdate ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: draft.sku.trim(),
            label: draft.label.trim(),
            color: draft.color,
            category: draft.category,
            startDate: draft.startDate,
            endDate: draft.endDate || null,
            notes: draft.notes,
          }),
        },
      );
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

  async function remove() {
    if (!draft?.id) return;
    if (!confirm(`Batch "${draft.label}" verwijderen?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/batches/${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("verwijderen mislukt");
      setDraft(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "verwijderen mislukt");
    } finally {
      setSaving(false);
    }
  }

  // Groepeer per SKU, batches chronologisch.
  const bySku = new Map<string, PartBatchRow[]>();
  for (const b of initialBatches) {
    const arr = bySku.get(b.sku) ?? [];
    arr.push(b);
    bySku.set(b.sku, arr);
  }
  for (const arr of bySku.values()) {
    arr.sort((a, b) => a.start_date.localeCompare(b.start_date));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setDraft(blank());
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nieuwe batch
        </button>
      </div>

      {bySku.size === 0 ? (
        <div className="rounded-xl border border-dashed border-brand-200 bg-white/50 px-4 py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-3">
            <Boxes className="w-6 h-6 text-brand-500" />
          </div>
          <p className="text-sm text-ink-muted max-w-sm mx-auto">
            Nog geen batches. Maak er één per SKU om vast te leggen welke versie
            van een onderdeel in welke periode geldt.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...bySku.entries()].map(([sku, batches]) => (
            <SkuCard
              key={sku}
              sku={sku}
              batches={batches}
              onEdit={(b) => {
                setError(null);
                setDraft(toDraft(b));
              }}
              onAdd={() => {
                setError(null);
                setDraft(blank(sku));
              }}
            />
          ))}
        </div>
      )}

      {draft && (
        <BatchModal
          draft={draft}
          saving={saving}
          error={error}
          onChange={patch}
          onClose={() => setDraft(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  );
}

function SkuCard({
  sku,
  batches,
  onEdit,
  onAdd,
}: {
  sku: string;
  batches: PartBatchRow[];
  onEdit: (b: PartBatchRow) => void;
  onAdd: () => void;
}) {
  // Meerdere onderdelen (moertjes, zuignappen, schroefjes…) kunnen tegelijk
  // actief zijn binnen één SKU. Groepeer daarom per categorie/onderdeel.
  const activeCount = batches.filter(isActive).length;

  const byCat = new Map<string, PartBatchRow[]>();
  for (const b of batches) {
    const key = b.category?.trim() || "Overig";
    const arr = byCat.get(key) ?? [];
    arr.push(b);
    byCat.set(key, arr);
  }
  // Binnen elke categorie: actief eerst, daarna nieuwste start bovenaan.
  for (const arr of byCat.values()) {
    arr.sort((a, b) => {
      const av = isActive(a) ? 1 : 0;
      const bv = isActive(b) ? 1 : 0;
      if (av !== bv) return bv - av;
      return b.start_date.localeCompare(a.start_date);
    });
  }
  const cats = [...byCat.keys()].sort((a, b) =>
    a === "Overig" ? 1 : b === "Overig" ? -1 : a.localeCompare(b),
  );

  return (
    <div className="rounded-xl border border-brand-100 bg-white shadow-soft overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-brand-100 bg-surface-muted/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-ink truncate">{sku}</span>
          <span className="text-xs text-ink-subtle">
            · {batches.length} batch{batches.length === 1 ? "" : "es"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {activeCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {activeCount} nu actief
            </span>
          ) : (
            <span className="text-xs text-alert-600">Geen actieve batch</span>
          )}
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" />
            batch
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-4">
        {cats.map((cat) => (
          <div key={cat}>
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-medium text-ink-subtle uppercase tracking-wide">
              <Tag className="w-3 h-3" />
              {cat}
            </div>
            <ul className="divide-y divide-brand-50">
              {(byCat.get(cat) ?? []).map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onEdit(b)}
                    className="w-full text-left px-1 py-2 flex items-center gap-3 hover:bg-surface-muted/50 rounded transition-colors"
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-white shadow-soft flex-shrink-0"
                      style={{ backgroundColor: b.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink font-medium truncate">
                          {b.label}
                        </span>
                        {isActive(b) && (
                          <span className="text-[10px] uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                            nu actief
                          </span>
                        )}
                      </div>
                      {b.notes && (
                        <div className="text-xs text-ink-subtle truncate">{b.notes}</div>
                      )}
                    </div>
                    <span className="text-xs text-ink-subtle tabular-nums whitespace-nowrap">
                      {fmt(b.start_date)} → {b.end_date ? fmt(b.end_date) : "nu"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function BatchModal({
  draft,
  saving,
  error,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft;
  saving: boolean;
  error: string | null;
  onChange: (p: Partial<Draft>) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-100">
          <h3 className="font-display text-lg font-semibold text-brand-700">
            {draft.id ? "Batch bewerken" : "Nieuwe batch"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink"
            aria-label="Sluiten"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
          <Field label="SKU">
            <input
              value={draft.sku}
              onChange={(e) => onChange({ sku: e.target.value })}
              placeholder="SOL-3000-ANT-180"
              className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </Field>
          <Field label="Label">
            <input
              value={draft.label}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder="Q1 2026 (paars)"
              className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Kleur">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) => onChange({ color: e.target.value })}
                  className="h-10 w-12 rounded-lg border border-brand-200 bg-white"
                />
                <span className="font-mono text-xs text-ink-muted">{draft.color}</span>
              </div>
            </Field>
            <Field label="Categorie">
              <input
                value={draft.category}
                onChange={(e) => onChange({ category: e.target.value })}
                placeholder="bevestiging"
                className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Geldig vanaf">
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => onChange({ startDate: e.target.value })}
                className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </Field>
            <Field label="Tot (leeg = nu)">
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => onChange({ endDate: e.target.value })}
                className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </Field>
          </div>
          <Field label="Notitie (wat te pakken)">
            <textarea
              value={draft.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              rows={2}
              placeholder="Oude bevestigingsset (M5 paars)"
              className="w-full rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </Field>

          {error && (
            <div className="rounded-lg bg-alert-50 border border-alert-200 px-3 py-2 text-sm text-alert-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-brand-100">
          <button
            type="button"
            onClick={onDelete}
            disabled={!draft.id || saving}
            className="inline-flex items-center gap-2 rounded-lg border border-alert-200 text-alert-600 px-3 py-2 text-sm font-medium hover:bg-alert-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            Verwijderen
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-muted transition-colors"
            >
              Annuleren
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-muted uppercase tracking-wide mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
