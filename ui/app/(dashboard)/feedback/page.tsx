import { ThumbsUp } from "lucide-react";
import { KLANTENSERVICE_MODULE } from "@factumai/agent-core";
import { requireModulePage } from "@/lib/auth/access";
import { cockpitEnv, makeClient } from "@/lib/db";
import { listFeedback, type FeedbackItem } from "@/lib/visitor-feedback";
import { FeedbackList } from "@/components/feedback/FeedbackList";

export const dynamic = "force-dynamic";

/**
 * Feedback van bezoekers, en wat je ermee doet.
 *
 * Dit scherm bestaat omdat een duim omlaag géén kennis is. Hij zegt dat iemand
 * niet geholpen is, niet wat het goede antwoord was — daar kun je de kennisbank
 * niet mee voeden zonder 'm te vervuilen. Wat je er wél mee kunt: er een
 * testcase van maken, en daarvoor is één oordeel van een mens genoeg.
 *
 * Vandaar dat de knoppen categorieën zijn en geen tekstveld. Kiezen kost vijf
 * seconden; een zin schrijven kost een minuut en gebeurt dus niet.
 */
export default async function FeedbackPage() {
  // Bezoekersfeedback hoort bij klantenservice: het gaat over antwoorden die
  // deze module gaf. Guard dekt geen-sessie én verkeerde-afdeling.
  const user = await requireModulePage(KLANTENSERVICE_MODULE.id);

  let nieuw: FeedbackItem[] = [];
  let behandeld: FeedbackItem[] = [];
  let loadError: string | null = null;
  try {
    const client = makeClient(cockpitEnv());
    nieuw = await listFeedback(client, { status: "NEW" });
    behandeld = await listFeedback(client, { status: "LABELED", limit: 25 });
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <PageHeader open={nieuw.length} />
      <div className="flex-1 overflow-y-auto p-4 sm:p-8">
        {loadError ? (
          <div className="max-w-md">
            <h2 className="font-display text-lg font-semibold text-alert-600 mb-1">
              Kon feedback niet laden
            </h2>
            <code className="text-xs bg-surface-muted px-2 py-1 rounded text-ink-subtle">
              {loadError}
            </code>
          </div>
        ) : (
          <div className="max-w-3xl flex flex-col gap-8">
            <section>
              <h2 className="font-display text-lg font-semibold mb-1">Te beoordelen</h2>
              <p className="text-sm text-ink-muted mb-4">
                Kies wát er misging. Dat label maakt er een testcase van — je hoeft geen
                beter antwoord te schrijven.
              </p>
              <FeedbackList items={nieuw} role={user.role} />
            </section>

            {behandeld.length > 0 && (
              <section>
                <h2 className="font-display text-lg font-semibold mb-1">Gelabeld</h2>
                <p className="text-sm text-ink-muted mb-4">
                  Deze gevallen zijn bruikbaar als testcase in de eval-set.
                </p>
                <FeedbackList items={behandeld} role={user.role} />
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function PageHeader({ open }: { open: number }) {
  return (
    <header className="border-b border-line px-4 sm:px-8 py-5">
      <div className="flex items-center gap-2">
        <ThumbsUp className="w-5 h-5 text-accent-500" aria-hidden="true" />
        <h1 className="font-display text-xl font-semibold">Feedback</h1>
        {open > 0 && (
          <span className="text-xs font-semibold bg-bucket-review/15 text-bucket-review px-2 py-0.5 rounded-full">
            {open} te beoordelen
          </span>
        )}
      </div>
      <p className="text-sm text-ink-muted mt-1">
        Wat bezoekers van de antwoorden vonden, en welke gevallen een testcase worden.
      </p>
    </header>
  );
}
