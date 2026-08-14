import Link from "next/link";
import { Clock, Check, AlertTriangle, Send, Layers } from "lucide-react";
import {
  TRIAGE_META,
  specialistLabel,
  type ReviewCardViewModel,
  type ReviewStatus,
  type TriageTier,
} from "@/lib/review";
import { cn, timeAgoNL } from "@/lib/utils";

interface MailCardProps {
  item: ReviewCardViewModel;
  /** Compacte enkele regel voor afgehandelde bakken (Verstuurd/Afgewezen). */
  compact?: boolean;
}

const KIND_LABELS: Record<string, string> = {
  draft_email: "Concept",
  draft_reply: "Concept",
};

export function MailCard({ item, compact = false }: MailCardProps) {
  if (compact) return <CompactCard item={item} />;
  return (
    <Link
      href={`/mail/${encodeURIComponent(item.id)}`}
      className={cn(
        "group block px-4 py-3",
        "hover:bg-brand-50/40 transition-colors",
        "focus-visible:outline-none focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset",
      )}
    >
      {/* Regel 1: afzender + tijd */}
      <div className="flex items-center gap-2">
        <StatusIcon status={item.status} />
        <span className="text-sm font-semibold text-ink truncate min-w-0 flex-1">
          {item.customer ?? "Onbekende afzender"}
        </span>
        <span className="tabular-nums text-xs text-ink-subtle whitespace-nowrap flex-shrink-0">
          {timeAgoNL(item.createdAt)}
        </span>
      </div>

      {/* Regel 2: onderwerp */}
      <div className="mt-1 text-sm text-ink truncate group-hover:text-brand-700">
        {item.subject}
      </div>

      {/* Regel 3: korte samenvatting van de vraag */}
      <p className="mt-0.5 text-xs text-ink-muted line-clamp-2 leading-snug">
        {item.summary}
      </p>

      {/* Regel 4: labels */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.triage && <TriageBadge tier={item.triage} />}
        {item.taskCount > 1 && <CompoundBadge count={item.taskCount} />}
        {item.specialist && <SpecialistBadge slug={item.specialist} />}
        {item.category && <CategoryBadge label={item.category} />}
        {item.confidence != null && (
          <ConfidenceBadge confidence={item.confidence} />
        )}
        <KindBadge kind={item.kind} />
      </div>
    </Link>
  );
}

/** Minimalistische enkele regel — gebruikt voor Verstuurd/Afgewezen. */
function CompactCard({ item }: { item: ReviewCardViewModel }) {
  return (
    <div className="group relative flex items-start sm:items-center hover:bg-brand-50/40 transition-colors">
      <Link
        href={`/mail/${encodeURIComponent(item.id)}`}
        className={cn(
          "flex-1 min-w-0 flex items-start sm:items-center gap-3 px-4 py-2.5",
          "focus-visible:outline-none focus-visible:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset",
        )}
      >
        <StatusIcon status={item.status} />

        <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="text-sm font-medium text-ink truncate sm:flex-shrink-0 sm:max-w-[40%]">
            {item.subject}
          </span>
          <span
            className="hidden sm:inline text-brand-200"
            aria-hidden="true"
          >
            ·
          </span>
          <span className="text-sm text-ink-muted truncate min-w-0 sm:flex-1 group-hover:text-ink">
            {item.summary}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 text-xs">
          {item.triage && <TriageBadge tier={item.triage} />}
          {item.confidence != null && (
            <span className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-ink-muted border border-brand-100 bg-white tabular-nums">
              {Math.round(item.confidence * 100)}%
            </span>
          )}
          <span className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-ink-muted border border-brand-100 bg-white">
            {KIND_LABELS[item.kind] ?? item.kind}
          </span>
          {item.decidedBy && (
            <span
              className="hidden lg:inline tabular-nums text-ink-subtle whitespace-nowrap truncate max-w-[160px]"
              title={`Door ${item.decidedBy}${item.decidedAt ? ` · ${timeAgoNL(item.decidedAt)}` : ""}`}
            >
              · door {item.decidedBy}
            </span>
          )}
          <span className="tabular-nums text-ink-subtle whitespace-nowrap">
            {timeAgoNL(item.decidedAt ?? item.createdAt)}
          </span>
        </div>
      </Link>
    </div>
  );
}

function StatusIcon({ status }: { status: ReviewStatus }) {
  const config: Record<
    ReviewStatus,
    { icon: typeof Clock; className: string; label: string }
  > = {
    PENDING: { icon: Clock, className: "text-ink-subtle", label: "Te reviewen" },
    APPROVED: { icon: Check, className: "text-ink-subtle", label: "Goedgekeurd" },
    EDITED: { icon: Check, className: "text-ink-subtle", label: "Bewerkt" },
    EXECUTED: { icon: Send, className: "text-ink-subtle", label: "Verstuurd" },
    REJECTED: {
      icon: AlertTriangle,
      className: "text-alert-500",
      label: "Afgewezen",
    },
  };

  const { icon: Icon, className, label } = config[status];
  return (
    <Icon
      className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5 sm:mt-0", className)}
      aria-label={label}
    />
  );
}

function TriageBadge({ tier }: { tier: TriageTier }) {
  const meta = TRIAGE_META[tier];
  const cls: Record<TriageTier, string> = {
    escalate: "bg-alert-50 text-alert-700 border-alert-200",
    review: "bg-accent-50 text-accent-700 border-accent-200",
    simple: "bg-green-50 text-green-700 border-green-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
        cls[tier],
      )}
    >
      {meta.label}
    </span>
  );
}

function CategoryBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-brand-700 border border-brand-200 bg-brand-50">
      {label}
    </span>
  );
}

/**
 * Toont welke specialist het concept schreef (single-intent) of welke intent
 * de eindtoon bepaalde (compound → precedence_intent). Zelfde stijl als de
 * categorie-badge maar een tint donkerder zodat de reviewer intuïtief
 * onderscheid maakt tussen "wat voor mail" en "wie schreef het".
 */
function SpecialistBadge({ slug }: { slug: string }) {
  const label = specialistLabel(slug) ?? slug;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-brand-800 border border-brand-300 bg-brand-100"
      title={`Specialist: ${label}`}
    >
      {label}
    </span>
  );
}

/**
 * Signaleert compound review-items: één antwoord samengesteld uit N
 * specialist-fragmenten. Reviewer weet dan meteen: de detailpagina laat
 * een breakdown zien.
 */
function CompoundBadge({ count }: { count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent-700 border border-accent-200 bg-accent-50"
      title={`Samengesteld antwoord uit ${count} deel-taken`}
    >
      <Layers className="w-3 h-3" />
      {count} taken
    </span>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-ink-muted border border-brand-100 bg-white">
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-ink-muted border border-brand-100 bg-white tabular-nums">
      {pct}%
    </span>
  );
}
