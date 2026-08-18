"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Hand, Check, X, RotateCcw } from "lucide-react";
import type { Ticket, TicketStatus } from "@factumai/agent-core";
import { cn } from "@/lib/utils";
import { timeAgoNL } from "@/lib/utils";
import { ActionReview } from "@/components/actions/ActionReview";
import type { ActionViewModel } from "@/lib/actions";

type Role = "admin" | "reviewer" | "viewer";

const TONE: Record<string, string> = {
  review: "bg-bucket-review",
  progress: "bg-accent-500",
  done: "bg-bucket-auto",
};

/** Welke knoppen horen bij welke status — spiegelt `canTransition` in agent-core. */
function actionsFor(status: TicketStatus): Array<{ to: TicketStatus; label: string; icon: typeof Hand }> {
  switch (status) {
    case "OPEN":
      return [
        { to: "IN_PROGRESS", label: "Oppakken", icon: Hand },
        { to: "CANCELLED", label: "Annuleren", icon: X },
      ];
    case "IN_PROGRESS":
      return [
        { to: "DONE", label: "Afronden", icon: Check },
        { to: "OPEN", label: "Loslaten", icon: RotateCcw },
      ];
    case "DONE":
      return [{ to: "OPEN", label: "Heropenen", icon: RotateCcw }];
    case "CANCELLED":
      return [];
  }
}

export function TicketList({
  title,
  description,
  tone,
  tickets,
  role,
  compact = false,
  actionsByReviewItem,
  focus,
}: {
  title: string;
  description: string;
  tone: keyof typeof TONE;
  tickets: Ticket[];
  role?: Role | null;
  compact?: boolean;
  /**
   * Klaargezette schrijfoperaties per ReviewItem. Het ticket is waar het
   * uitzoekwerk leeft, dus is het ook de plek waar een medewerker de bijbehorende
   * actie wil aftekenen — zonder eerst naar het conceptscherm te hoeven.
   */
  actionsByReviewItem?: Record<string, ActionViewModel[]>;
  /**
   * Het ticket waar de bezoeker naartoe is gestuurd (`/tickets?focus=<id>`).
   *
   * Alleen markeren en in beeld brengen — niet filteren. Wie vanaf een werkitem
   * komt wil dát ticket zien, maar hij wil ook kunnen zien wat er verder ligt;
   * een lijst die opeens één regel toont is desoriënterend.
   */
  focus?: string | null;
}) {
  const router = useRouter();
  // Het gezochte ticket in beeld brengen. Zonder dit staat de markering er wel,
  // maar drie schermen naar beneden.
  const gezocht = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    gezocht.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Viewers kijken mee maar handelen niet af.
  const mayAct = role === "admin" || role === "reviewer";

  async function move(id: string, to: TicketStatus) {
    setBusy(`${id}:${to}`);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Actie mislukt");
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col rounded-lg bg-white border border-brand-100 overflow-hidden">
      <div className="flex items-stretch border-b border-brand-100">
        <div className={cn("w-0.5 flex-shrink-0", TONE[tone])} />
        <div className="flex-1 min-w-0 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <h3 className="font-medium text-ink text-sm truncate">{title}</h3>
            <span className="text-xs tabular-nums text-ink-muted">{tickets.length}</span>
          </div>
          <p className="text-xs text-ink-muted mt-0.5 truncate">{description}</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="px-4 py-2 text-xs bg-alert-50 text-alert-700">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
        {tickets.length === 0 ? (
          <p className="text-center py-8 px-4 text-sm text-ink-subtle">Niets hier.</p>
        ) : (
          <ul className="divide-y divide-brand-50">
            {tickets.map((t) => (
              <li
                key={t.id}
                id={`ticket-${t.id}`}
                ref={t.id === focus ? gezocht : undefined}
                className={cn(
                  "px-4 py-3",
                  // Een rand en geen achtergrondkleur: de statuskleuren van de
                  // kaart blijven zo leesbaar, en de markering valt op zonder
                  // de rest te overstemmen.
                  t.id === focus && "ring-2 ring-brand-400 ring-inset rounded-lg",
                )}
              >
                <div className="flex items-baseline gap-2">
                  <code className="text-xs font-medium text-brand-700">{t.number}</code>
                  <span className="text-[11px] text-ink-subtle">{timeAgoNL(t.createdAt)}</span>
                </div>
                <p className="text-sm text-ink mt-1">{t.summary}</p>

                {!compact && (
                  <dl className="mt-1.5 text-xs text-ink-muted space-y-0.5">
                    {t.contactEmail && (
                      <div className="truncate">
                        <span className="text-ink-subtle">Klant: </span>
                        {t.contactEmail}
                      </div>
                    )}
                    {t.orderReference ? (
                      <div>
                        <span className="text-ink-subtle">Order: </span>
                        {t.orderReference}
                      </div>
                    ) : (
                      <div className="text-bucket-review">Geen ordernummer — navragen</div>
                    )}
                    {t.claimedBy && (
                      <div className="truncate">
                        <span className="text-ink-subtle">Opgepakt door: </span>
                        {t.claimedBy}
                      </div>
                    )}
                  </dl>
                )}

                {/* Voorgestelde schrijfoperaties bij dit ticket. Boven de
                    statusknoppen: eerst zien wat de agent wil doen, dan pas
                    beslissen of het ticket verder mag. */}
                {(actionsByReviewItem?.[t.reviewItemId ?? ""] ?? []).length > 0 && (
                  <div className="mt-2">
                    <ActionReview
                      actions={actionsByReviewItem?.[t.reviewItemId ?? ""] ?? []}
                      autoOpen={t.id === focus}
                    />
                  </div>
                )}

                {mayAct && actionsFor(t.status).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {actionsFor(t.status).map(({ to, label, icon: Icon }) => (
                      <button
                        key={to}
                        type="button"
                        onClick={() => move(t.id, to)}
                        disabled={busy !== null}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                          "border border-brand-200 text-ink-muted hover:bg-brand-50 transition-colors",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                        )}
                      >
                        {busy === `${t.id}:${to}` ? (
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <Icon className="w-3 h-3" aria-hidden="true" />
                        )}
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pending && <p className="px-4 py-2 text-xs text-ink-subtle">Verversen…</p>}
    </section>
  );
}
