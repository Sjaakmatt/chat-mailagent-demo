/**
 * `/gesprekken` — de route. Zie `tickets/page.tsx` voor de opzet.
 */

import { klantenserviceModule } from "@/lib/modules/klantenservice";
import { GesprekkenScreen } from "@/lib/modules/klantenservice/screens/Gesprekken";
import { requireModulePage } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export default async function GesprekkenPage() {
  await requireModulePage(klantenserviceModule.id);
  return <GesprekkenScreen />;
}
