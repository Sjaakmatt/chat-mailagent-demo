import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Mail,
  MessageSquare,
  Paperclip,
  Download,
} from "lucide-react";
import {
  cockpitEnv,
  makeClient,
  getReviewItem,
  listReviewEdits,
} from "@/lib/db";
import { signAttachmentUrl } from "@/lib/storage";
import { ReviewForm } from "@/components/mail-detail/ReviewForm";
import { CaseTimeline } from "@/components/mail-detail/CaseTimeline";
import { CompoundBreakdown } from "@/components/mail-detail/CompoundBreakdown";
import { cn, timeAgoNL } from "@/lib/utils";

function formatBytes(n?: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const dynamic = "force-dynamic";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  PENDING: {
    label: "Te reviewen",
    color: "text-accent-700",
    bg: "bg-accent-50",
    border: "border-accent-200",
  },
  APPROVED: {
    label: "Goedgekeurd",
    color: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200",
  },
  EDITED: {
    label: "Bewerkt & verstuurd",
    color: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200",
  },
  EXECUTED: {
    label: "Verstuurd",
    color: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200",
  },
  REJECTED: {
    label: "Afgewezen",
    color: "text-alert-700",
    bg: "bg-alert-50",
    border: "border-alert-200",
  },
};

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = safeDecode(rawId);

  let row;
  let env: ReturnType<typeof cockpitEnv> | undefined;
  try {
    env = cockpitEnv();
    row = await getReviewItem(makeClient(env), id);
  } catch {
    row = undefined;
  }

  if (!row) {
    return (
      <>
        <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-4">
          <BackLink />
        </div>
        <div className="flex-1 flex items-center justify-center p-12">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 rounded-full bg-alert-50 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-7 h-7 text-alert-500" />
            </div>
            <h2 className="font-display text-lg font-semibold text-brand-700 mb-1">
              ReviewItem niet gevonden
            </h2>
            <p className="text-ink-muted text-sm">
              Het item met id{" "}
              <code className="text-xs bg-surface-muted px-1 py-0.5 rounded">
                {id}
              </code>{" "}
              bestaat niet of is verwijderd.
            </p>
          </div>
        </div>
      </>
    );
  }

  const proposed = row.proposed ?? {};
  const subject = proposed.subject ?? row.summary;
  const body = proposed.body ?? "";
  const ungrounded = proposed.guardrail?.ungroundedClaims ?? [];
  const grounding = row.grounding ?? [];
  const meta = STATUS_META[row.status] ?? STATUS_META.PENDING;
  const editable = row.status === "PENDING";
  const toEmail = proposed.resolved?.enrichment?.toEmail;
  const original = proposed.original;
  const classification = proposed.classification;
  const extractedEntries = Object.entries(classification?.extracted ?? {}).filter(
    ([, v]) => v != null && v !== "",
  );
  const policy = proposed.policy;
  const thread = original?.thread ?? [];
  const attachments = await Promise.all(
    (original?.attachments ?? []).map(async (a) => ({
      ...a,
      url: a.path && env ? await signAttachmentUrl(env, a.path) : null,
    })),
  );

  // Audit-trail: edit-historie (snapshots per save/decision). Een domeinmodule
  // die extra tijdlijn-punten wil tonen, haalt ze hier op en geeft ze door als
  // `extraEvents` aan <CaseTimeline> — zie examples/warehouse-module.
  let edits: Awaited<ReturnType<typeof listReviewEdits>> = [];
  try {
    if (env) {
      edits = await listReviewEdits(makeClient(env), row.id);
    }
  } catch {
    edits = [];
  }

  return (
    <>
      {/* Header */}
      <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
        <BackLink />
        <div className="flex items-start justify-between gap-4 mt-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold text-brand-700 leading-tight">
              {subject}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-ink-muted">
              <span className="capitalize">{row.kind.replace(/_/g, " ")}</span>
              {toEmail && (
                <>
                  <span className="text-brand-200">·</span>
                  <span>
                    Aan <span className="text-ink">{toEmail}</span>
                  </span>
                </>
              )}
              <span className="text-brand-200">·</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {timeAgoNL(row.created_at)}
              </span>
            </div>
          </div>

          <div
            className={cn(
              "flex flex-col items-end gap-0.5 px-3 py-2 rounded-lg border",
              meta.bg,
              meta.border,
            )}
          >
            <span className={cn("text-sm font-semibold", meta.color)}>
              {meta.label}
            </span>
            {row.status !== "PENDING" && row.decided_by && (
              <span className={cn("text-[11px] opacity-80", meta.color)}>
                door {row.decided_by}
                {row.decided_at ? ` · ${timeAgoNL(row.decided_at)}` : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1400px] mx-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* LINKS — origineel + concept + acties */}
            <div className="lg:col-span-3 space-y-6">
              <OriginalMail original={original} />
              <Attachments attachments={attachments} />
              {row.compound === true && row.tasks && row.tasks.length > 0 && (
                <CompoundBreakdown
                  tasks={row.tasks}
                  precedenceIntent={row.precedence_intent}
                />
              )}
              <ReviewForm
                id={row.id}
                initialSubject={subject}
                initialBody={body}
                editable={editable}
                noReply={proposed.noReply === true}
                noReplyReason={proposed.noReplyReason ?? null}
              />
              <ThreadRail thread={thread} />
            </div>

            {/* RECHTS — tijdlijn, analyse, samenvatting, grounding, guardrail, confidence */}
            <div className="lg:col-span-2 space-y-6">
              <Panel title="Tijdlijn">
                <CaseTimeline item={row} edits={edits} />
              </Panel>

              <AgentAnalysis
                category={classification?.category}
                extracted={extractedEntries}
                policy={policy}
              />

              <Panel title="Samenvatting">
                <p className="text-sm text-ink leading-relaxed">{row.summary}</p>
              </Panel>

              {row.confidence != null && (
                <Panel title="Vertrouwen">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-display font-semibold text-ink tabular-nums">
                      {Math.round(row.confidence * 100)}%
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-brand-100 overflow-hidden">
                      <div
                        className="h-full bg-brand-500"
                        style={{
                          width: `${Math.round(row.confidence * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </Panel>
              )}

              {ungrounded.length > 0 && (
                <Panel title="Guardrail-waarschuwing" tone="warn">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-alert-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-alert-700">
                      <p className="font-medium mb-1">
                        Niet-gegronde claims gevonden:
                      </p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {ungrounded.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Panel>
              )}

              <Panel title="Grounding">
                {grounding.length === 0 ? (
                  <p className="text-sm text-ink-subtle">
                    Geen grounding-referenties.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {grounding.map((g, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-ink"
                      >
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        <span>
                          {g.claim}{" "}
                          <span className="text-ink-subtle">({g.tool})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-brand-700 transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      Terug naar werkbak
    </Link>
  );
}

/** De originele klantmail (snapshot uit het ReviewItem) — van/onderwerp/tekst. */
function OriginalMail({
  original,
}: {
  original?: {
    subject?: string;
    bodyText?: string;
    from?: string;
    [key: string]: unknown;
  };
}) {
  const from = original?.from;
  const subject = original?.subject;
  const bodyText = original?.bodyText;
  const hasContent = Boolean(from || subject || bodyText);

  return (
    <div className="rounded-xl border border-brand-100 bg-white shadow-soft overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-brand-100 bg-surface-muted/50">
        <Mail className="w-4 h-4 text-brand-500" />
        <h3 className="text-xs font-medium text-ink-muted uppercase tracking-wide">
          Originele mail
        </h3>
      </div>
      {!hasContent ? (
        <div className="px-4 py-6 text-sm text-ink-subtle">
          Geen snapshot van de originele mail beschikbaar (ouder ReviewItem).
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3">
          <div className="space-y-1 text-sm">
            {from && (
              <div className="flex gap-2">
                <span className="text-ink-muted w-16 flex-shrink-0">Van</span>
                <span className="text-ink font-medium break-all">{from}</span>
              </div>
            )}
            {subject && (
              <div className="flex gap-2">
                <span className="text-ink-muted w-16 flex-shrink-0">Onderwerp</span>
                <span className="text-ink">{subject}</span>
              </div>
            )}
          </div>
          {bodyText &&
            (/<\/?(html|body|div|p|table|br|span|a|img)\b/i.test(bodyText) ? (
              <iframe
                // Gesandboxed (geen scripts): veilige render van onvertrouwde mail-HTML.
                sandbox=""
                srcDoc={bodyText}
                title="Originele mail"
                className="w-full h-96 rounded-lg border border-brand-100 bg-white"
              />
            ) : (
              <div className="rounded-lg bg-surface-muted/60 border border-brand-100/60 p-3 max-h-96 overflow-auto">
                <p className="text-sm text-ink whitespace-pre-wrap break-words leading-relaxed">
                  {bodyText}
                </p>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Triage-uitkomst van de agent: categorie + geëxtraheerde velden. */
function AgentAnalysis({
  category,
  extracted,
  policy,
}: {
  category?: string;
  extracted: [string, unknown][];
  policy?: { ruleId?: string; ruleName?: string; action?: string };
}) {
  if (!category && extracted.length === 0 && !policy?.ruleName) return null;
  return (
    <Panel title="Agent-analyse">
      <div className="space-y-3">
        {policy?.ruleName && (
          <div className="flex items-start gap-2">
            <span className="text-sm text-ink-muted">Beleid</span>
            <span className="text-sm text-ink font-medium">
              {policy.ruleName}
              {policy.action ? (
                <span className="text-ink-subtle font-normal">
                  {" "}
                  · {policy.action.replace(/_/g, " ")}
                </span>
              ) : null}
            </span>
          </div>
        )}
        {category && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-muted">Categorie</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200 capitalize">
              {category.replace(/_/g, " ")}
            </span>
          </div>
        )}
        {extracted.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-ink-muted uppercase tracking-wide">
              Geëxtraheerd
            </span>
            <ul className="space-y-0.5">
              {extracted.map(([k, v]) => (
                <li key={k} className="flex gap-2 text-sm">
                  <span className="text-ink-muted capitalize">
                    {k.replace(/([A-Z])/g, " $1").toLowerCase()}
                  </span>
                  <span className="text-ink font-medium tabular-nums break-all">
                    {String(v)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Conversatie-context (thread-snapshot). */
function ThreadRail({
  thread,
}: {
  thread: {
    id?: string;
    from?: string;
    subject?: string;
    receivedDateTime?: string;
    bodyPreview?: string;
    isRead?: boolean;
  }[];
}) {
  if (!thread || thread.length === 0) return null;
  return (
    <div className="rounded-xl border border-brand-100 bg-white shadow-soft overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-brand-100 bg-surface-muted/50">
        <MessageSquare className="w-4 h-4 text-brand-500" />
        <h3 className="text-xs font-medium text-ink-muted uppercase tracking-wide">
          Thread ({thread.length})
        </h3>
      </div>
      <ol className="divide-y divide-brand-50">
        {thread.map((msg, i) => (
          <li key={msg.id ?? i} className="px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink font-medium truncate">
                {msg.from ?? "—"}
              </span>
              {msg.receivedDateTime && (
                <span className="text-xs text-ink-subtle whitespace-nowrap">
                  {timeAgoNL(msg.receivedDateTime)}
                </span>
              )}
            </div>
            {msg.bodyPreview && (
              <p className="text-sm text-ink-muted mt-0.5 line-clamp-2">
                {msg.bodyPreview}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Bijlagen: afbeelding/video direct zichtbaar, overige bestanden als download. */
function Attachments({
  attachments,
}: {
  attachments: {
    id: string;
    name: string;
    size?: number;
    note?: string;
    contentType?: string;
    url: string | null;
  }[];
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <Panel title={`Bijlagen (${attachments.length})`}>
      <ul className="space-y-3">
        {attachments.map((a) => {
          const isImage = Boolean(a.contentType?.startsWith("image/"));
          const isVideo = Boolean(a.contentType?.startsWith("video/"));
          const isMedia = (isImage || isVideo) && Boolean(a.url);
          return (
            <li key={a.id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-ink-subtle flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate">{a.name}</div>
                  {(a.size || a.note) && (
                    <div className="text-xs text-ink-subtle">
                      {formatBytes(a.size)}
                      {a.note ? ` · ${a.note}` : ""}
                    </div>
                  )}
                </div>
                {/* Download alleen voor niet-media bestanden. */}
                {!isMedia && a.url && (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 transition-colors"
                    title="Downloaden"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
              </div>

              {isImage && a.url && (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.url}
                    alt={a.name}
                    className="rounded-lg border border-brand-100 max-h-80 w-auto"
                  />
                </a>
              )}
              {isVideo && a.url && (
                <video
                  src={a.url}
                  controls
                  className="rounded-lg border border-brand-100 w-full max-h-80"
                />
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Panel({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border shadow-soft p-4",
        tone === "warn"
          ? "bg-alert-50/50 border-alert-200"
          : "bg-white border-brand-100",
      )}
    >
      <h3 className="text-xs font-medium text-ink-muted uppercase tracking-wide mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}
