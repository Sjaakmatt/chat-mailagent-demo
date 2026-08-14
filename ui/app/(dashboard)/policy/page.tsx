import { Settings, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/require-role";
import { cockpitEnv, makeClient, listPolicyRules, type PolicyRuleRow } from "@/lib/db";
import { PolicyEditor } from "@/components/policy/PolicyEditor";

export const dynamic = "force-dynamic";

export default async function PolicyPage() {
  const user = await getCurrentUser();
  const env = cockpitEnv();
  // Fase 5C: alleen op staging + met parent-org configureren toont de
  // policy-editor "Push naar prod"-knoppen per rule.
  const promoteEnabled =
    env.COCKPIT_MODE === "staging" && Boolean(env.AIOS_PARENT_ORG_ID);

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
              Alleen beheerders kunnen het beleid bewerken.
            </p>
          </div>
        </div>
      </>
    );
  }

  let rules: PolicyRuleRow[] = [];
  try {
    rules = await listPolicyRules(makeClient(env));
  } catch {
    rules = [];
  }

  return (
    <>
      <PageHeader />
      <div className="flex-1 overflow-auto">
        <div className="max-w-[1200px] mx-auto p-4 sm:p-6">
          <PolicyEditor initialRules={rules} promoteEnabled={promoteEnabled} />
        </div>
      </div>
    </>
  );
}

function PageHeader() {
  return (
    <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
      <h1 className="font-display text-2xl font-semibold text-brand-700 leading-tight flex items-center gap-2">
        <Settings className="w-6 h-6 text-brand-500" />
        Beleid
      </h1>
      <p className="text-sm text-ink-muted mt-1">
        Regels per categorie sturen het concept van de agent. De agent kiest de
        actieve regel met de laagste prioriteit en volgt de richtlijn — alles
        blijft via review (nooit autonoom versturen).
      </p>
    </div>
  );
}
