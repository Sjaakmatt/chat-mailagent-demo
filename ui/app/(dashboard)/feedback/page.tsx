/**
 * `/feedback` — de route. Zie `tickets/page.tsx` voor de opzet.
 */

import { klantenserviceModule } from "@/lib/modules/klantenservice";
import { FeedbackScreen } from "@/lib/modules/klantenservice/screens/Feedback";
import { requireModulePage } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const user = await requireModulePage(klantenserviceModule.id);
  return <FeedbackScreen user={user} />;
}
