import { TopBar } from "@/components/dashboard/TopBar";
import { TriageBucket } from "@/components/dashboard/TriageBucket";
import { RealtimeRefresh } from "@/components/dashboard/RealtimeRefresh";
import { authEnv } from "@/lib/supabase/env";
import { cockpitEnv, makeClient, listReviewItems } from "@/lib/db";
import {
  toCardViewModel,
  bucketFor,
  type ReviewCardViewModel,
  type ReviewItemRow,
} from "@/lib/review";

// De werkbak is server-rendered tegen aios_review_items. Geen caching: elke
// load toont de actuele stand.
export const dynamic = "force-dynamic";

export default async function WerkbakPage() {
  let rows: ReviewItemRow[];
  let loadError: string | null = null;
  const env = cockpitEnv();
  const orgId = env.AIOS_ORG_ID;
  try {
    const client = makeClient(env);
    rows = await listReviewItems(client);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    rows = [];
  }

  if (loadError) {
    return (
      <>
        <TopBar pendingCount={0} />
        <div className="flex-1 flex items-center justify-center p-12">
          <div className="text-center max-w-md">
            <h2 className="font-display text-lg font-semibold text-alert-600 mb-1">
              Kon de werkbak niet laden
            </h2>
            <p className="text-ink-muted text-sm">
              Controleer de Supabase-secrets van de Worker.
            </p>
            <code className="mt-3 inline-block text-xs bg-surface-muted px-2 py-1 rounded text-ink-subtle">
              {loadError}
            </code>
          </div>
        </div>
      </>
    );
  }

  const pending: ReviewCardViewModel[] = [];
  const sent: ReviewCardViewModel[] = [];
  const rejected: ReviewCardViewModel[] = [];

  // Afgehandelde items (verstuurd/afgewezen) tonen we max. 24u; ouder → Auditlog.
  // Openstaande review blijft altijd staan, ongeacht leeftijd.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const decidedRecently = (row: ReviewItemRow): boolean => {
    const t = Date.parse(row.decided_at ?? row.executed_at ?? row.created_at);
    return Number.isNaN(t) ? true : t >= cutoff;
  };

  for (const row of rows) {
    const bucket = bucketFor(row.status);
    if (bucket === "review") {
      pending.push(toCardViewModel(row));
      continue;
    }
    if (!decidedRecently(row)) continue;
    const vm = toCardViewModel(row);
    if (bucket === "sent") sent.push(vm);
    else rejected.push(vm);
  }

  // Prioriteits-"smaken" binnen de openstaande review. Onbepaald (oudere items
  // zonder triage) valt in Review — die wil je sowieso even bekijken.
  const escalate = pending.filter((v) => v.triage === "escalate");
  const simple = pending.filter((v) => v.triage === "simple");
  const review = pending.filter((v) => v.triage !== "escalate" && v.triage !== "simple");

  const auth = authEnv();

  return (
    <>
      <TopBar pendingCount={pending.length} />

      <div className="flex-1 p-4 sm:p-6 overflow-auto">
        <div className="flex justify-end mb-3">
          <RealtimeRefresh
            table="aios_review_items"
            supabaseUrl={auth?.url}
            supabaseAnonKey={auth?.anon}
            organizationId={orgId}
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatBox label="Simpel" value={simple.length} accent="auto" />
          <StatBox label="Review" value={review.length} accent="review" />
          <StatBox label="Escalatie" value={escalate.length} accent="escalate" />
          <StatBox label="Verstuurd" value={sent.length} accent="default" />
        </div>

        {/* Openstaand, geprioriteerd in drie smaken. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <TriageBucket
            title="Simpel"
            description="Hoge zekerheid — snel door te drukken."
            color="auto"
            items={simple}
            emptyMessage="Geen simpele concepten."
          />
          <TriageBucket
            title="Review"
            description="Onzekere constateringen — even goed nakijken."
            color="review"
            items={review}
            emptyMessage="Niets dat extra review nodig heeft."
          />
          <TriageBucket
            title="Escalatie"
            description="Juridische dreiging of ernstige kwestie — mens beslist."
            color="escalate"
            items={escalate}
            emptyMessage="Geen escalaties."
          />
        </div>

        {/* Afgehandeld. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TriageBucket
            title="Verstuurd"
            description="Goedgekeurd/verstuurd in de afgelopen 24u — ouder in Auditlog."
            color="auto"
            items={sent}
            emptyMessage="Niets verstuurd in de afgelopen 24u."
            compact
          />
          <TriageBucket
            title="Afgewezen"
            description="Afgewezen in de afgelopen 24u — ouder in Auditlog."
            color="pending"
            items={rejected}
            emptyMessage="Geen afwijzingen in de afgelopen 24u."
            compact
          />
        </div>
      </div>
    </>
  );
}

type StatAccent = "default" | "auto" | "review" | "escalate";

function StatBox({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: number;
  accent?: StatAccent;
}) {
  const accentBar: Record<StatAccent, string> = {
    default: "bg-brand-200",
    auto: "bg-green-500",
    review: "bg-accent-400",
    escalate: "bg-alert-500",
  };

  return (
    <div className="bg-white rounded-lg border border-brand-100 flex items-stretch overflow-hidden">
      <div className={`w-0.5 flex-shrink-0 ${accentBar[accent]}`} />
      <div className="px-4 py-3 flex-1 min-w-0">
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-2xl font-display font-semibold text-ink mt-0.5 tabular-nums">
          {value}
        </div>
      </div>
    </div>
  );
}
