import { Sidebar } from "@/components/dashboard/Sidebar";
import { StagingBanner } from "@/components/dashboard/StagingBanner";
import { getCurrentUser, type AuthedUser } from "@/lib/auth/require-role";
import { accessFor } from "@/lib/auth/access";
import { MODULES } from "@/lib/modules";
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

  // De schermen van de modules waar deze gebruiker in mag. Hier en niet in de
  // zijbalk: die is een client-component en mag de moduleregistry niet
  // importeren — `collectSources` trekt daar de database-laag mee de
  // browserbundel in.
  //
  // Het icoon gaat als gerénderd element mee: een componentfunctie overleeft de
  // RSC-grens niet.
  //
  // Fail-soft, net als hierboven: valt de rechtenquery om, dan toont de zijbalk
  // geen module-schermen. Dat is vervelend maar veilig, en de pagina's zelf
  // weigeren alsnog via `requireModulePage`.
  let moduleNav: { href: string; label: string; icon: React.ReactNode }[] = [];
  if (user) {
    try {
      const { access } = await accessFor(user);
      moduleNav = MODULES.filter((m) => access.mayEnter(m.id)).flatMap((m) =>
        (m.navItems ?? []).map((item) => ({
          href: item.href,
          label: item.label,
          icon: <item.icon className="w-4 h-4" aria-hidden="true" />,
        })),
      );
    } catch (err) {
      console.warn(
        "[dashboard-layout] modulenavigatie overgeslagen:",
        err instanceof Error ? err.message : String(err),
      );
    }
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
        moduleNav={moduleNav}
      />
      <main className="flex-1 flex flex-col min-h-screen min-w-0 pt-16 lg:pt-0">
        {isStaging && <StagingBanner organizationId={stagingOrgId} />}
        {children}
      </main>
    </div>
  );
}
