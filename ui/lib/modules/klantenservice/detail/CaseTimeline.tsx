import {
  Mail,
  Sparkles,
  Scale,
  CheckCircle2,
  Send,
  AlertTriangle,
  Pencil,
} from "lucide-react";
import type { ReviewItemRow } from "@/lib/review";
import type { ReviewEditRow } from "@/lib/db";
import { cn } from "@/lib/utils";
import { mailProposed } from "@/lib/modules/klantenservice";

interface CaseTimelineProps {
  item: ReviewItemRow;
  edits?: ReviewEditRow[];
  /**
   * Extra tijdlijn-punten van een domeinmodule (bv. een magazijn-werkticket).
   * Worden samen met de kern-events chronologisch gesorteerd, zodat een
   * klant-eigen stap gewoon op z'n plek in het verhaal verschijnt.
   */
  extraEvents?: TimelineEvent[];
}

export interface TimelineEvent {
  icon: typeof Mail;
  label: string;
  /** Subkopje (bijv. "door X" of toelichting). */
  detail?: string;
  /** ISO-datum; ongedefinieerd voor inferred/onbekende momenten. */
  at?: string | null;
  /** Kleur-accent. */
  tone?: "default" | "green" | "amber" | "coral" | "purple";
}

const TONE: Record<NonNullable<TimelineEvent["tone"]>, { dot: string; text: string }> = {
  default: { dot: "bg-brand-200 text-brand-700", text: "text-ink" },
  green: { dot: "bg-green-100 text-green-700", text: "text-ink" },
  amber: { dot: "bg-accent-100 text-accent-700", text: "text-ink" },
  coral: { dot: "bg-alert-100 text-alert-700", text: "text-ink" },
  purple: { dot: "bg-brand-100 text-brand-700", text: "text-ink" },
};

function fmt(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Verticale tijdlijn van de hele case: van ontvangen → geclassificeerd →
 * beleid → beslissing → verstuurd, aangevuld met wat een domeinmodule via
 * `extraEvents` aandraagt. Zo zie je in één oogopslag wat er met de mail is
 * gebeurd én wie het heeft gedaan.
 */
export function CaseTimeline({
  item,
  edits = [],
  extraEvents = [],
}: CaseTimelineProps) {
  const proposed = mailProposed(item);
  const original = proposed.original;
  const classification = proposed.classification;
  const policy = proposed.policy;

  const events: TimelineEvent[] = [];

  // 1. Originele mail (klant) — als we de receivedDateTime weten.
  if (original?.receivedDateTime) {
    const from = typeof original.from === "string" ? original.from : undefined;
    events.push({
      icon: Mail,
      label: "Mail ontvangen",
      detail: from ? `van ${from}` : undefined,
      at: original.receivedDateTime,
      tone: "default",
    });
  }

  // 2. Signal opgepikt door de agent (created_at = moment van intake).
  events.push({
    icon: Sparkles,
    label: "Door agent opgepikt",
    detail: classification?.category
      ? `geclassificeerd als ${classification.category}` +
        (typeof classification.confidence === "number"
          ? ` · ${Math.round(classification.confidence * 100)}%`
          : "")
      : "geclassificeerd",
    at: item.created_at,
    tone: "purple",
  });

  // 3. Toegepaste beleidsregel.
  if (policy?.ruleName) {
    events.push({
      icon: Scale,
      label: `Beleid: ${policy.ruleName}`,
      detail: policy.action ? `actie ${policy.action}` : undefined,
      at: item.created_at,
      tone: "default",
    });
  }

  // 3b. Tussentijdse handmatige saves van het concept (audit-historie).
  for (const e of edits) {
    if (e.source !== "manual_save") continue;
    events.push({
      icon: Pencil,
      label: "Concept opgeslagen",
      detail: `door ${e.edited_by}`,
      at: e.edited_at,
      tone: "default",
    });
  }

  // 4. Beslissing (approve/edit/reject) — alleen als gemaakt.
  if (item.decided_at && item.status !== "PENDING") {
    const decisionMap: Record<
      string,
      { icon: typeof CheckCircle2; label: string; tone: TimelineEvent["tone"] }
    > = {
      APPROVED: { icon: CheckCircle2, label: "Goedgekeurd", tone: "green" },
      EDITED: { icon: Pencil, label: "Bewerkt & goedgekeurd", tone: "green" },
      EXECUTED: { icon: CheckCircle2, label: "Goedgekeurd", tone: "green" },
      REJECTED: { icon: AlertTriangle, label: "Afgewezen", tone: "coral" },
    };
    const m = decisionMap[item.status] ?? decisionMap.APPROVED;
    events.push({
      icon: m.icon,
      label: m.label,
      detail: item.decided_by ? `door ${item.decided_by}` : undefined,
      at: item.decided_at,
      tone: m.tone,
    });
  }

  // 5. Reply verstuurd (executed_at).
  if (item.executed_at) {
    events.push({
      icon: Send,
      label: "Antwoord verstuurd naar klant",
      at: item.executed_at,
      tone: "purple",
    });
  }

  // 6. Punten die een domeinmodule aandraagt (leeg in het fundament).
  events.push(...extraEvents);

  // Chronologisch sorteren op .at (events zonder datum vallen achteraan).
  events.sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : Number.POSITIVE_INFINITY;
    const tb = b.at ? Date.parse(b.at) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  return (
    <ol className="relative space-y-3 pl-1">
      {events.map((e, i) => {
        const tone = TONE[e.tone ?? "default"];
        const Icon = e.icon;
        const last = i === events.length - 1;
        return (
          <li key={i} className="relative flex gap-3">
            {/* Verticale lijn tussen punten */}
            {!last && (
              <span
                className="absolute left-[11px] top-6 bottom-[-12px] w-px bg-brand-100"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center",
                tone.dot,
              )}
            >
              <Icon className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className={cn("text-sm font-medium", tone.text)}>
                {e.label}
              </div>
              {e.detail && (
                <div className="text-xs text-ink-muted truncate">{e.detail}</div>
              )}
              <div className="text-[11px] text-ink-subtle tabular-nums">
                {fmt(e.at)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
