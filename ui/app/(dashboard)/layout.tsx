import { Sidebar } from "@/components/dashboard/Sidebar";
import { StagingBanner } from "@/components/dashboard/StagingBanner";
import { getCurrentUser, type AuthedUser } from "@/lib/auth/require-role";
import { cockpitEnv } from "@/lib/db";
import { isDemoEnabled } from "@/lib/demo/enabled";

// De middleware bewaakt al de toegang; deze layout draait per request.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Supabase-auth: de middleware laat alleen ingelogde sessies door; hier halen
  // we e-mail + rol op voor de sidebar (en sign-out). Fail-soft: als de cookie-
  // /auth-call op de RSC-fetch knalt mogen we de pagina niet kapotmaken
  // (anders krijg je een 500 op élke route in deze layout).
  let user: AuthedUser | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    console.warn(
      "[dashboard-layout] getCurrentUser threw:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Staging-detectie: alleen als de env-var `COCKPIT_MODE === "staging"`
  // renderen we de banner. Prod-cockpit (default) toont hem nooit.
  let isStaging = false;
  let stagingOrgId: string | undefined;
  let demoEnabled = false;
  try {
    const env = cockpitEnv();
    isStaging = env.COCKPIT_MODE === "staging";
    stagingOrgId = env.AIOS_ORG_ID;
    demoEnabled = isDemoEnabled(env);
  } catch {
    // env-lookup faalt bij lokale dev zonder wrangler — silently niet-staging
  }

  return (
    // items-start zodat de sticky sidebar zijn eigen scroll-context houdt en
    // niet meebeweegt met de main-content. min-h-screen + min-w-0 op main
    // voorkomt dat lange werktickets de pagina-layout breken.
    <div className="flex items-start min-h-screen bg-surface-muted">
      <Sidebar
        userEmail={user?.email ?? null}
        role={user?.role ?? null}
        demoEnabled={demoEnabled}
      />
      <main className="flex-1 flex flex-col min-h-screen min-w-0 pt-16 lg:pt-0">
        {isStaging && <StagingBanner organizationId={stagingOrgId} />}
        {children}
      </main>
    </div>
  );
}
