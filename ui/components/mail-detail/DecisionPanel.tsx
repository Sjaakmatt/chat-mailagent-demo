import { AlertTriangle, CheckCircle2, Database, ShieldOff } from "lucide-react";
import { notableEvents, type DecisionLog } from "@factumai/agent-core";
import { cn } from "@/lib/utils";

const OUTCOME_LABEL: Record<string, string> = {
  kennis: "Kennis",
  systeem: "Systeem",
  taak: "Taak",
  onbekend: "Onbekend",
};

/**
 * Toont waaróm de agent besloot wat hij besloot. Bewust bovenaan de
 * afwijkingen: een run die netjes doorliep is één regel, een run waarin de
 * poort dichtsloeg of de uitkomst degradeerde laat precies zien waar dat
 * gebeurde. Dat is wat je nodig hebt als een klant belt over een oud antwoord.
 */
export function DecisionPanel({ log }: { log: DecisionLog | null }) {
  if (!log) {
    return (
      <p className="text-sm text-ink-subtle">
        Geen beslislog voor dit item. Runs van vóór de invoering hebben er geen.
      </p>
    );
  }

  const events = notableEvents(log);
  const outcome = log.outcome;

  return (
    <div className="space-y-4">
      {events.length === 0 ? (
        <div className="flex items-start gap-2 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>Zonder bijzonderheden door de lus gelopen.</span>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink">
              <AlertTriangle
                className="w-4 h-4 mt-0.5 flex-shrink-0 text-bucket-review"
                aria-hidden="true"
              />
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-ink-subtle">Kanaal</dt>
        <dd className="text-ink">{log.channel}</dd>

        <dt className="text-ink-subtle">Domeingrens</dt>
        <dd className={cn("flex items-center gap-1.5", log.inDomain ? "text-ink" : "text-alert-700")}>
          {!log.inDomain && <ShieldOff className="w-3.5 h-3.5" aria-hidden="true" />}
          {log.inDomain ? "gepasseerd" : "geblokkeerd"}
        </dd>

        {outcome && (
          <>
            <dt className="text-ink-subtle">Uitkomst</dt>
            <dd className="text-ink">
              {OUTCOME_LABEL[outcome.outcome] ?? outcome.outcome}
              {outcome.degradedFrom && (
                <span className="text-ink-subtle">
                  {" "}
                  (verlaagd van {OUTCOME_LABEL[outcome.degradedFrom] ?? outcome.degradedFrom})
                </span>
              )}
            </dd>
          </>
        )}

        {log.specialist && (
          <>
            <dt className="text-ink-subtle">Specialist</dt>
            <dd className="text-ink">{log.specialist}</dd>
          </>
        )}
      </dl>

      {log.sources.length > 0 && (
        <div>
          <div className="text-xs font-medium text-ink-subtle uppercase tracking-wide mb-1.5">
            Geraadpleegde bronnen
          </div>
          <ul className="space-y-1">
            {log.sources.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <Database
                  className={cn(
                    "w-3.5 h-3.5 flex-shrink-0",
                    s.hit ? "text-ink-subtle" : "text-alert-500",
                  )}
                  aria-hidden="true"
                />
                <code className="text-xs text-ink">{s.tool}</code>
                {!s.hit && <span className="text-xs text-alert-700">geen resultaat</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
