/**
 * `/tickets` — de route, meer niet.
 *
 * Het scherm zelf is van de module (`ui/lib/modules/klantenservice/screens/`).
 * Wat hier overblijft is wat de schil hoort te doen: de rechtencontrole, en het
 * doorgeven van wat Next aanlevert.
 *
 * De guard staat hier en niet in het scherm, met opzet: `check-module-guards`
 * leest `page.tsx`-bestanden, en een guard die een laag dieper verhuist, is een
 * guard die een volgende keer stilletjes kan verdwijnen.
 */

import { klantenserviceModule } from "@/lib/modules/klantenservice";
import { TicketsScreen } from "@/lib/modules/klantenservice/screens/Tickets";
import { requireModulePage } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const user = await requireModulePage(klantenserviceModule.id);
  return <TicketsScreen searchParams={searchParams} user={user} />;
}
