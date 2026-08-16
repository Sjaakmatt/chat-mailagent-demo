import Link from "next/link";
import {
  FileClock,
  Download,
  Search,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Mail,
  Package,
} from "lucide-react";
import {
  cockpitEnv,
  makeClient,
  listAuditEntriesPage,
  listAuditFacets,
} from "@/lib/db";
import { DOMAIN_AUDIT_SOURCES } from "@/lib/audit-sources";
import { categoryLabel } from "@/lib/modules";
import { timeAgoNL } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const ACTION_META: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "Goedgekeurd", cls: "bg-green-50 text-green-700 border-green-200" },
  EDITED: { label: "Bewerkt", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  EXECUTED: { label: "Verstuurd", cls: "bg-brand-50 text-brand-700 border-brand-200" },
  REJECTED: { label: "Afgewezen", cls: "bg-alert-50 text-alert-700 border-alert-200" },
  CLAIMED: { label: "Opgepakt", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  SHIPPED: { label: "Verstuurd", cls: "bg-green-50 text-green-700 border-green-200" },
  CANCELLED: { label: "Geannuleerd", cls: "bg-surface-muted text-ink-muted border-brand-100" },
};

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    from?: string;
    to?: string;
    decidedBy?: string;
    category?: string;
    source?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? "";
  const q = sp.q ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const decidedBy = sp.decidedBy ?? "";
  const category = sp.category ?? "";
  const sourceParam = sp.source ?? "";
  const validSources = ["review", ...DOMAIN_AUDIT_SOURCES.map((s) => s.id)];
  const source: string = validSources.includes(sourceParam) ? sourceParam : "all";
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);

  let entries: Awaited<ReturnType<typeof listAuditEntriesPage>>["entries"] = [];
  let hasNext = false;
  let facets: Awaited<ReturnType<typeof listAuditFacets>> = {
    decidedBy: [],
    categories: [],
  };
  try {
    const client = makeClient(cockpitEnv());
    const [res, fcs] = await Promise.all([
      listAuditEntriesPage(client, {
        status,
        q,
        from,
        to,
        decidedBy,
        category,
        source,
        page,
        pageSize: PAGE_SIZE,
      }),
      listAuditFacets(client),
    ]);
    entries = res.entries;
    hasNext = res.hasNext;
    facets = fcs;
  } catch {
    entries = [];
  }

  const base = { status, q, from, to, decidedBy, category, source };

  return (
    <>
      <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-brand-700 leading-tight flex items-center gap-2">
              <FileClock className="w-6 h-6 text-brand-500" />
              Auditlog
            </h1>
            <p className="text-sm text-ink-muted mt-1">
              Alle beslissingen — wie, wat en wanneer. Filter op periode en zoek terug.
            </p>
          </div>
          <a
            href={`/api/audit/export${qs(base)}`}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </a>
        </div>

        {/* Filters (GET-form) */}
        <form className="flex flex-col lg:flex-row lg:flex-wrap gap-3 mt-4" method="get">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Zoek op onderwerp of reviewer…"
              className="w-full rounded-lg border border-brand-200 pl-9 pr-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Van
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="rounded-lg border border-brand-200 px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Tot
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="rounded-lg border border-brand-200 px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            />
          </label>
          <select
            name="source"
            defaultValue={source === "all" ? "" : source}
            className="rounded-lg border border-brand-200 px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <option value="">Alle bronnen</option>
            <option value="review">Mail-beslissingen</option>
            {DOMAIN_AUDIT_SOURCES.map((src) => (
              <option key={src.id} value={src.id}>
                {src.label}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={status}
            className="rounded-lg border border-brand-200 px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <option value="">Alle acties</option>
            <optgroup label="Mail">
              <option value="APPROVED">Goedgekeurd</option>
              <option value="EDITED">Bewerkt</option>
              <option value="EXECUTED">Verstuurd</option>
              <option value="REJECTED">Afgewezen</option>
            </optgroup>
            {DOMAIN_AUDIT_SOURCES.map((src) => (
              <optgroup key={src.id} label={src.label}>
                {src.actions.map((a) => (
                  <option key={a} value={a}>
                    {src.actionLabels?.[a] ?? a}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            name="decidedBy"
            defaultValue={decidedBy}
            className="rounded-lg border border-brand-200 px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 max-w-[200px]"
          >
            <option value="">Iedereen</option>
            {facets.decidedBy.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <select
            name="category"
            defaultValue={category}
            className="rounded-lg border border-brand-200 px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 max-w-[220px]"
          >
            <option value="">Alle categorieën</option>
            {facets.categories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c) ?? c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Filter
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-[1100px] mx-auto p-4 sm:p-6">
          <div className="rounded-xl border border-brand-100 bg-white shadow-soft overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-100 bg-surface-muted/50 text-xs font-medium text-ink-muted uppercase tracking-wide flex items-center justify-between">
              <span>
                Pagina {page + 1}
                {entries.length > 0 ? ` · ${entries.length} op deze pagina` : ""}
              </span>
            </div>
            {entries.length === 0 ? (
              <div className="px-4 py-8 text-sm text-ink-subtle text-center">
                Geen acties gevonden.
              </div>
            ) : (
              <div className="divide-y divide-brand-50">
                {entries.map((e) => {
                  const meta = ACTION_META[e.action] ?? {
                    label: e.action,
                    cls: "bg-surface-muted text-ink-muted border-brand-100",
                  };
                  const domainSrc = DOMAIN_AUDIT_SOURCES.find(
                    (s) => s.id === e.source,
                  );
                  const SourceIcon = domainSrc ? Package : Mail;
                  const domainHref = domainSrc?.linkHref?.(e) ?? null;
                  const categoryNice = e.source === "review" && e.meta
                    ? (categoryLabel(e.meta) ?? e.meta)
                    : null;
                  return (
                    <div
                      key={e.key}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3"
                    >
                      <span
                        className="text-ink-subtle flex-shrink-0"
                        title={domainSrc?.label ?? "Mail"}
                      >
                        <SourceIcon className="w-4 h-4" />
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border w-fit ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink truncate">
                          {e.summary}
                        </div>
                        <div className="text-xs text-ink-subtle truncate">
                          {e.by ?? "—"}
                          {categoryNice ? ` · ${categoryNice}` : ""}
                          {domainSrc && e.meta ? ` · ${e.meta}` : ""}
                        </div>
                      </div>
                      <span className="text-xs text-ink-muted whitespace-nowrap">
                        {timeAgoNL(e.at)}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Domein-event → direct naar het bijbehorende record,
                            als de domeinbron een link aanlevert. */}
                        {domainHref && (
                          <Link
                            href={domainHref}
                            className="text-ink-subtle hover:text-brand-700"
                            title={`Bekijk in ${domainSrc?.label ?? "module"}`}
                          >
                            <Package className="w-4 h-4" />
                          </Link>
                        )}
                        {/* Naar de bron-mail (geldt ook voor domein-events: die
                            zijn altijd uit een mail ontstaan via review_item_id). */}
                        {e.reviewItemId ? (
                          <Link
                            href={`/mail/${encodeURIComponent(e.reviewItemId)}`}
                            className="text-ink-subtle hover:text-brand-700"
                            title="Bekijk bron-mail"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                        ) : (
                          <span className="w-4" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Paginering */}
          <div className="flex items-center justify-between mt-4">
            {page > 0 ? (
              <Link
                href={`/audit${qs({ ...base, page: page - 1 })}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Vorige
              </Link>
            ) : (
              <span />
            )}
            {hasNext ? (
              <Link
                href={`/audit${qs({ ...base, page: page + 1 })}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 transition-colors"
              >
                Volgende
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
