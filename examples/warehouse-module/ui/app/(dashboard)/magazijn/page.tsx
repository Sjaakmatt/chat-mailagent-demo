import { Package } from "lucide-react";
import { cockpitEnv, makeClient, listShipmentTasks, type ShipmentTaskRow } from "@/lib/db";
import { ShipmentList } from "@/components/warehouse/ShipmentList";
import { RealtimeRefresh } from "@/components/dashboard/RealtimeRefresh";
import { authEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function MagazijnPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const sp = await searchParams;
  const focusId = sp.focus ?? null;

  const env = cockpitEnv();
  let tasks: ShipmentTaskRow[] = [];
  try {
    tasks = await listShipmentTasks(makeClient(env));
  } catch {
    tasks = [];
  }

  // Nieuw + in behandeling blijven altijd staan; afgehandeld (DONE) tonen we
  // max. 24u; ouder → alleen via Auditlog (de bron-mail/beslissing blijft
  // daar bewaard).
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  tasks = tasks.filter((t) => {
    if (t.status === "OPEN" || t.status === "IN_PROGRESS") return true;
    const ts = Date.parse(t.completed_at ?? t.updated_at ?? t.created_at);
    return Number.isNaN(ts) ? true : ts >= cutoff;
  });

  const auth = authEnv();

  return (
    <>
      <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-brand-700 leading-tight flex items-center gap-2">
              <Package className="w-6 h-6 text-brand-500" />
              Magazijn
            </h1>
            <p className="text-sm text-ink-muted mt-1">
              Verzendtaken die ontstaan bij goedgekeurde mails waar het beleid een
              nazending vereist. Pick de onderdelen en markeer als verstuurd.
            </p>
          </div>
          <RealtimeRefresh
            table="aios_shipment_tasks"
            supabaseUrl={auth?.url}
            supabaseAnonKey={auth?.anon}
            organizationId={env.AIOS_ORG_ID}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-[1000px] mx-auto p-4 sm:p-6">
          <ShipmentList tasks={tasks} focusId={focusId} />
        </div>
      </div>
    </>
  );
}
