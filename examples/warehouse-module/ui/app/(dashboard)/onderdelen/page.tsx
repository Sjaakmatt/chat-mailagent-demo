import { Boxes, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/require-role";
import { cockpitEnv, makeClient, listBatches, type PartBatchRow } from "@/lib/db";
import { BatchEditor } from "@/components/warehouse/BatchEditor";

export const dynamic = "force-dynamic";

export default async function OnderdelenPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== "admin") {
    return (
      <>
        <PageHeader />
        <div className="flex-1 flex items-center justify-center p-12">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 rounded-full bg-alert-50 flex items-center justify-center mx-auto mb-3">
              <ShieldAlert className="w-7 h-7 text-alert-500" />
            </div>
            <h2 className="font-display text-lg font-semibold text-brand-700 mb-1">
              Geen toegang
            </h2>
            <p className="text-ink-muted text-sm">
              Alleen beheerders kunnen onderdeel-batches beheren.
            </p>
          </div>
        </div>
      </>
    );
  }

  let batches: PartBatchRow[] = [];
  try {
    batches = await listBatches(makeClient(cockpitEnv()));
  } catch {
    batches = [];
  }

  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1100px] mx-auto p-4 sm:p-6">
          <BatchEditor initialBatches={batches} />
        </div>
      </div>
    </>
  );
}

function PageHeader() {
  return (
    <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
      <h1 className="font-display text-2xl font-semibold text-brand-700 leading-tight flex items-center gap-2">
        <Boxes className="w-6 h-6 text-brand-500" />
        Onderdelen
      </h1>
      <p className="text-sm text-ink-muted mt-1">
        Batches per SKU met geldigheidsperiode. De agent kiest bij een
        nazending de batch die gold op de besteldatum, zodat het magazijn de
        juiste versie van het onderdeel pakt.
      </p>
    </div>
  );
}
