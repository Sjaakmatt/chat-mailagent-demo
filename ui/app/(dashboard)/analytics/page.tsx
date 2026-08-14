import {
  BarChart3,
  Inbox,
  CheckCircle2,
  Clock,
  Send,
  Gauge,
} from "lucide-react";
import { cockpitEnv, makeClient, listReviewRows } from "@/lib/db";
import { computeMetrics, humanDuration } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export default async function AnalyticsPage() {
  let rows: Awaited<ReturnType<typeof listReviewRows>> = [];
  try {
    rows = await listReviewRows(makeClient(cockpitEnv()));
  } catch {
    rows = [];
  }
  const m = computeMetrics(rows);
  const maxCat = Math.max(1, ...m.byCategory.map((c) => c.count));
  const maxDay = Math.max(1, ...m.byDay.map((d) => d.count));

  return (
    <>
      <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
        <h1 className="font-display text-2xl font-semibold text-brand-700 leading-tight flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-brand-500" />
          Analytics
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          Overzicht van de werkbak — volumes, beslissingen en doorlooptijden.
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-[1100px] mx-auto p-4 sm:p-6 space-y-6">
          {/* KPI-kaarten */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Stat icon={Inbox} label="Totaal items" value={String(m.total)} />
            <Stat
              icon={Clock}
              label="Te reviewen"
              value={String(m.pending)}
              tone={m.pending > 0 ? "warn" : "default"}
            />
            <Stat
              icon={CheckCircle2}
              label="Goedkeuringsratio"
              value={pct(m.approvalRate)}
              sub={`${m.positive}/${m.decided} besliste`}
            />
            <Stat icon={Send} label="Verstuurd" value={String(m.executed)} />
            <Stat
              icon={Clock}
              label="Gem. reviewtijd"
              value={humanDuration(m.avgReviewMinutes)}
              sub="ontvangst → beslissing"
            />
            <Stat
              icon={Gauge}
              label="Gem. vertrouwen"
              value={pct(m.avgConfidence)}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Beslissingen */}
            <Card title="Beslissingen">
              <div className="space-y-2">
                <Distribution label="Goedgekeurd" value={m.approved} total={m.total} color="bg-green-500" />
                <Distribution label="Bewerkt" value={m.edited} total={m.total} color="bg-blue-500" />
                <Distribution label="Verstuurd" value={m.executed} total={m.total} color="bg-brand-500" />
                <Distribution label="Afgewezen" value={m.rejected} total={m.total} color="bg-alert-500" />
                <Distribution label="Te reviewen" value={m.pending} total={m.total} color="bg-accent-400" />
              </div>
            </Card>

            {/* Categorieën */}
            <Card title="Categorieën">
              {m.byCategory.length === 0 ? (
                <Empty />
              ) : (
                <div className="space-y-2">
                  {m.byCategory.slice(0, 8).map((c) => (
                    <div key={c.category} className="flex items-center gap-3">
                      <span className="text-sm text-ink w-32 truncate capitalize">
                        {c.category.replace(/_/g, " ")}
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-brand-100 overflow-hidden">
                        <div
                          className="h-full bg-brand-500"
                          style={{ width: `${(c.count / maxCat) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-ink-muted tabular-nums w-8 text-right">
                        {c.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Volume per dag */}
          <Card title="Volume per dag (laatste 14)">
            {m.byDay.length === 0 ? (
              <Empty />
            ) : (
              <div className="flex items-end gap-2 h-40">
                {m.byDay.map((d) => (
                  <div
                    key={d.day}
                    className="flex-1 flex flex-col items-center gap-1 min-w-0"
                    title={`${d.day}: ${d.count}`}
                  >
                    <div className="w-full flex items-end justify-center flex-1">
                      <div
                        className="w-full max-w-[28px] rounded-t bg-brand-400"
                        style={{ height: `${(d.count / maxDay) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-ink-subtle tabular-nums">
                      {d.day.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={`rounded-xl border shadow-soft p-4 ${
        tone === "warn"
          ? "bg-accent-50 border-accent-200"
          : "bg-white border-brand-100"
      }`}
    >
      <div className="flex items-center gap-2 text-ink-muted mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-display font-semibold text-ink tabular-nums">
        {value}
      </div>
      {sub && <div className="text-xs text-ink-subtle mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-white shadow-soft p-4">
      <h3 className="text-xs font-medium text-ink-muted uppercase tracking-wide mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Distribution({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const w = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-ink w-28">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-surface-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${w}%` }} />
      </div>
      <span className="text-sm text-ink-muted tabular-nums w-8 text-right">
        {value}
      </span>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-ink-subtle">Nog geen data.</p>;
}
