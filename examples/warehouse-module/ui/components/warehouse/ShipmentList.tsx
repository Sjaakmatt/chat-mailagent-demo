"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  RotateCcw,
  Loader2,
  Truck,
  ExternalLink,
  User,
  MapPin,
  Hash,
  Download,
  X,
  PackageOpen,
  UserCheck,
} from "lucide-react";
import { cn, timeAgoNL } from "@/lib/utils";
import type { ShipmentTaskRow, ShipmentStatus } from "@/lib/db";

const STATUS_BADGE: Record<ShipmentStatus, { label: string; cls: string }> = {
  OPEN: {
    label: "Nieuw",
    cls: "bg-accent-50 text-accent-700 border-accent-200",
  },
  IN_PROGRESS: {
    label: "In behandeling",
    cls: "bg-blue-50 text-blue-700 border-blue-200",
  },
  DONE: {
    label: "Verwerkt",
    cls: "bg-green-50 text-green-700 border-green-200",
  },
  CANCELLED: {
    label: "Geannuleerd",
    cls: "bg-surface-muted text-ink-muted border-brand-100",
  },
};

export function ShipmentList({
  tasks,
  focusId,
}: {
  tasks: ShipmentTaskRow[];
  /** Bij een deep-link uit de Auditlog (`?focus=<id>`): direct de detail-modaal openen. */
  focusId?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShipmentTaskRow | null>(null);

  // Auto-focus: als de URL ?focus=<id> heeft en die taak nog in de lijst staat
  // (open, in behandeling of binnen 24u verwerkt), opent de modaal direct.
  useEffect(() => {
    if (!focusId) return;
    const t = tasks.find((row) => row.id === focusId);
    if (t) setDetail(t);
  }, [focusId, tasks]);

  async function setStatus(id: string, status: ShipmentStatus) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("bijwerken mislukt");
      setDetail(null);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "bijwerken mislukt");
    } finally {
      setBusy(null);
    }
  }

  const nieuw = tasks.filter((t) => t.status === "OPEN");
  const bezig = tasks.filter((t) => t.status === "IN_PROGRESS");
  const klaar = tasks.filter(
    (t) => t.status === "DONE" || t.status === "CANCELLED",
  );

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-alert-50 border border-alert-200 px-3 py-2 text-sm text-alert-700">
          {error}
        </div>
      )}

      <Section title={`Nieuw (${nieuw.length})`}>
        {nieuw.length === 0 ? (
          <Empty>Geen nieuwe verzendtaken.</Empty>
        ) : (
          nieuw.map((t) => (
            <TaskCard key={t.id} t={t} busy={busy === t.id}>
              <button
                type="button"
                onClick={() => setStatus(t.id, "IN_PROGRESS")}
                disabled={busy === t.id}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 text-white px-3 py-2 text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-60"
              >
                {busy === t.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PackageOpen className="w-4 h-4" />
                )}
                Oppakken
              </button>
            </TaskCard>
          ))
        )}
      </Section>

      {bezig.length > 0 && (
        <Section title={`In behandeling (${bezig.length})`}>
          {bezig.map((t) => (
            <TaskCard key={t.id} t={t} busy={busy === t.id}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStatus(t.id, "OPEN")}
                  disabled={busy === t.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-brand-200 text-brand-700 px-3 py-2 text-sm font-medium hover:bg-brand-50 transition-colors disabled:opacity-60"
                  title="Terugzetten op nieuw zodat iemand anders 'm kan oppakken"
                >
                  <RotateCcw className="w-4 h-4" />
                  Loslaten
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(t.id, "DONE")}
                  disabled={busy === t.id}
                  className="inline-flex items-center gap-2 rounded-lg bg-green-600 text-white px-3 py-2 text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
                >
                  {busy === t.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Markeer verstuurd
                </button>
              </div>
            </TaskCard>
          ))}
        </Section>
      )}

      {klaar.length > 0 && (
        <Section title={`Verwerkt (${klaar.length})`}>
          <div className="space-y-2">
            {klaar.map((t) => (
              <CompactTaskCard key={t.id} t={t} onOpen={() => setDetail(t)} />
            ))}
          </div>
          <p className="text-xs text-ink-subtle">
            Verwerkte taken verdwijnen na 24u hier; ouder blijft via de
            Auditlog terug te vinden.
          </p>
        </Section>
      )}

      {detail && (
        <ShipmentModal
          t={detail}
          busy={busy === detail.id}
          onClose={() => setDetail(null)}
          onReopen={() => setStatus(detail.id, "OPEN")}
        />
      )}
    </div>
  );
}

/** Ingeklapt kaartje voor afgehandelde taken — klik opent de volle details. */
function CompactTaskCard({
  t,
  onOpen,
}: {
  t: ShipmentTaskRow;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-xl border border-brand-100 bg-white shadow-soft px-4 py-3 flex items-center justify-between gap-3 hover:bg-brand-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <User className="w-4 h-4 text-brand-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-ink truncate">
            {t.customer_name ?? t.customer_email ?? "Klant"}
          </span>
          <span className={cn(
            "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
            STATUS_BADGE[t.status].cls,
          )}>
            {STATUS_BADGE[t.status].label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-subtle mt-0.5">
          {t.order_reference && (
            <span className="inline-flex items-center gap-1 font-mono">
              <Hash className="w-3 h-3" />
              {t.order_reference}
            </span>
          )}
          <span>{timeAgoNL(t.completed_at ?? t.created_at)}</span>
          {t.claimed_by && (
            <span title={`Opgepakt door ${t.claimed_by}`}>
              opgepakt door {t.claimed_by}
            </span>
          )}
          {t.completed_by && (
            <span title={`Verstuurd door ${t.completed_by}`}>
              verstuurd door {t.completed_by}
            </span>
          )}
        </div>
      </div>
      {t.label && (
        <a
          href={`/label/${encodeURIComponent(t.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Verzendlabel
        </a>
      )}
    </div>
  );
}

/** Modaal met de volledige (oude) details van een afgehandelde taak. */
function ShipmentModal({
  t,
  busy,
  onClose,
  onReopen,
}: {
  t: ShipmentTaskRow;
  busy: boolean;
  onClose: () => void;
  onReopen: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-auto bg-white rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-brand-100">
          <h3 className="font-display text-base font-semibold text-brand-700">
            Verzendtaak
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
        <div className="p-4">
          <TaskCard t={t} busy={busy}>
            <button
              type="button"
              onClick={onReopen}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-brand-200 text-brand-700 px-3 py-2 text-sm font-medium hover:bg-brand-50 transition-colors disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Heropenen
            </button>
          </TaskCard>
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  t,
  busy,
  muted,
  children,
}: {
  t: ShipmentTaskRow;
  busy: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const items = Array.isArray(t.items) ? t.items : [];
  const badge = STATUS_BADGE[t.status];
  return (
    <div
      className={cn(
        "rounded-xl border bg-white shadow-soft overflow-hidden",
        muted ? "border-brand-50 opacity-80" : "border-brand-100",
        busy && "opacity-60",
      )}
    >
      <div className="p-4 space-y-3">
        {/* Kop: klant + status-pill + order + verzendlabel */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <User className="w-4 h-4 text-brand-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-ink truncate">
                {t.customer_name ?? t.customer_email ?? "Klant"}
              </span>
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
                  badge.cls,
                )}
              >
                {badge.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-subtle mt-0.5">
              {t.order_reference && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <Hash className="w-3 h-3" />
                  {t.order_reference}
                </span>
              )}
              <span>{timeAgoNL(t.created_at)}</span>
              {t.claimed_by && (
                <span
                  className="inline-flex items-center gap-1 text-blue-700"
                  title={`Opgepakt door ${t.claimed_by}${t.claimed_at ? ` · ${timeAgoNL(t.claimed_at)}` : ""}`}
                >
                  <UserCheck className="w-3 h-3" />
                  opgepakt door {t.claimed_by}
                </span>
              )}
              {t.completed_by && (
                <span
                  className="inline-flex items-center gap-1 text-green-700"
                  title={`Verstuurd door ${t.completed_by}${t.completed_at ? ` · ${timeAgoNL(t.completed_at)}` : ""}`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  verstuurd door {t.completed_by}
                </span>
              )}
            </div>
          </div>
          {t.label && (
            <a
              href={`/label/${encodeURIComponent(t.id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Verzendlabel
            </a>
          )}
        </div>

        {/* Klantvraag */}
        {t.description && <p className="text-sm text-ink-muted">{t.description}</p>}

        {/* Afleveradres */}
        {t.customer_address && (
          <div className="rounded-lg bg-surface-muted/60 border border-brand-100/60 p-2.5">
            <div className="text-[10px] font-medium text-ink-subtle uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              Afleveradres
            </div>
            <div className="text-sm text-ink whitespace-pre-line">
              {t.customer_address}
            </div>
          </div>
        )}

        {/* Te picken (SKU's) */}
        {items.length > 0 && (
          <div>
            <div className="text-[10px] font-medium text-ink-subtle uppercase tracking-wide mb-1.5">
              Te picken
            </div>
            <ul className="space-y-2">
              {items.map((it, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="w-7 h-7 rounded-md bg-accent-100 text-accent-700 font-semibold text-xs flex items-center justify-center flex-shrink-0">
                    {it.quantity ?? 1}×
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-ink truncate">
                        {it.name ?? it.sku ?? "Onderdeel"}
                      </span>
                      {it.sku && (
                        <span className="font-mono text-xs text-ink-muted flex-shrink-0">
                          {it.sku}
                        </span>
                      )}
                    </div>
                    {Array.isArray(it.batches) && it.batches.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {it.batches.map((b, j) => (
                          <li
                            key={j}
                            className="flex items-center gap-1.5 text-xs text-ink-muted"
                          >
                            <span
                              className="w-3 h-3 rounded-full border border-white shadow-soft flex-shrink-0"
                              style={{ backgroundColor: b.color ?? "#999" }}
                              aria-hidden="true"
                            />
                            <span>
                              {b.category ? `${b.category}: ` : ""}
                              {b.label}
                              {b.notes ? ` — ${b.notes}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Voet: tracking + bron + actie */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-brand-50">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
            {t.label && (
              <span className="inline-flex items-center gap-1 font-mono">
                <Truck className="w-3 h-3" />
                {t.label}
              </span>
            )}
            {t.review_item_id && (
              <Link
                href={`/mail/${encodeURIComponent(t.review_item_id)}`}
                className="inline-flex items-center gap-1 text-brand-600 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                bron
              </Link>
            )}
          </div>
          <div className="flex-shrink-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-medium text-ink-muted uppercase tracking-wide">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-brand-200 bg-white/50 px-4 py-8 text-center text-sm text-ink-subtle">
      {children}
    </div>
  );
}
