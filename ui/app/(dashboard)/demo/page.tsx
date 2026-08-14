import { PlayCircle, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/require-role";
import { cockpitEnv } from "@/lib/db";
import { isDemoEnabled } from "@/lib/demo/enabled";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { DemoPanel } from "@/components/demo/DemoPanel";

export const dynamic = "force-dynamic";

/**
 * Demo-pagina: laat een prospect de agent live zien zonder dat er een mailbox
 * gekoppeld is. Alleen zichtbaar als `DEMO_MODE=true` op de Worker staat, en
 * alleen voor beheerders — het zet echte signalen in de echte pipeline.
 */
export default async function DemoPage() {
  const user = await getCurrentUser();
  const demoOn = isDemoEnabled(cockpitEnv());

  if (!demoOn || !user || user.role !== "admin") {
    return (
      <>
        <PageHeader />
        <div className="flex-1 flex items-center justify-center p-12">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 rounded-full bg-alert-50 flex items-center justify-center mx-auto mb-3">
              <ShieldAlert className="w-7 h-7 text-alert-500" aria-hidden="true" />
            </div>
            <h2 className="font-display text-lg font-semibold text-brand-700 mb-1">
              {demoOn ? "Geen toegang" : "Demo-modus staat uit"}
            </h2>
            <p className="text-ink-muted text-sm">
              {demoOn
                ? "Alleen beheerders kunnen de demo starten."
                : "Zet DEMO_MODE=true op de cockpit-Worker om deze pagina te gebruiken."}
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-3xl space-y-6">
          <div className="rounded-lg border border-brand-100 bg-white p-4">
            <h2 className="font-display text-base font-semibold text-brand-700 mb-1">
              Hoe deze demo werkt
            </h2>
            <p className="text-sm text-ink-muted">
              De gekozen mails worden als echt signaal op de work-bus gezet. De
              agent classificeert ze, haalt order- en trackinggegevens op,
              schrijft een concept en zet dat als ReviewItem in de werkbak —
              precies zoals bij een live mailbox. Wat je straks ziet is dus het
              echte gedrag van de agent, geen schermafdruk.
            </p>
            <p className="text-sm text-ink-muted mt-2">
              Niets gaat naar buiten: uitgaande mail vereist altijd een
              menselijke goedkeuring, en de afzenders zijn fictief.
            </p>
          </div>

          <DemoPanel scenarios={DEMO_SCENARIOS} />
        </div>
      </div>
    </>
  );
}

function PageHeader() {
  return (
    <header className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
      <div className="flex items-center gap-2">
        <PlayCircle className="w-5 h-5 text-brand-500" aria-hidden="true" />
        <h1 className="font-display text-xl font-semibold text-brand-700">
          Demo
        </h1>
      </div>
      <p className="text-sm text-ink-muted mt-0.5">
        Toon de agent aan een klant met synthetische mail.
      </p>
    </header>
  );
}
