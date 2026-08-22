/**
 * `/gesprekken/<id>` — de route. Zie `tickets/page.tsx` voor de opzet.
 */

import { klantenserviceModule } from "@/lib/modules/klantenservice";
import { GesprekScreen } from "@/lib/modules/klantenservice/screens/Gesprek";
import { requireModulePage } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export default async function GesprekPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModulePage(klantenserviceModule.id);
  return <GesprekScreen params={params} />;
}
