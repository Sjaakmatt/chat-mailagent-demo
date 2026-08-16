import { CheckCircle2, XCircle, Info } from "lucide-react";
import type { AnalyseStatus } from "@/lib/assistant/analyse";
import { cn } from "@/lib/utils";

/**
 * De stand van de analyse-laag, met per voorwaarde waarom hij aan of uit staat.
 *
 * Het punt van dit paneel is de **reden**. "Analyse staat uit" is nutteloos;
 * "analyse staat uit omdat factumai-mcp-erp nog vier ongeclassificeerde tools
 * heeft" is een taak. De briefing zegt het ook zo: voldoet er iets niet, dan
 * blijft de vlag uit mét de reden erbij.
 */
export function AnalysePanel({ status }: { status: AnalyseStatus }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-brand-700">
        Analyse-laag
      </h2>
      <p className="text-sm text-ink-muted mt-1">
        Aggregeren over verzamelingen — klachtenpercentages, doorlooptijden,
        marges. Staat los van het dossier en gaat alleen aan als aan alle
        voorwaarden is voldaan.
      </p>

      <div
        className={cn(
          "mt-4 rounded-lg border px-4 py-3",
          status.actief
            ? "border-green-200 bg-green-50"
            : "border-brand-100 bg-surface-muted",
        )}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          {status.actief ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" aria-hidden="true" />
          ) : (
            <XCircle className="w-4 h-4 text-ink-subtle" aria-hidden="true" />
          )}
          {status.actief ? "Actief" : "Uit"}
        </div>
        {!status.vlag && (
          <p className="mt-1 text-xs text-ink-muted">
            De vlag <code className="text-[11px]">ASSISTANT_ANALYSE</code> staat niet
            aan in de Worker-configuratie.
          </p>
        )}
      </div>

      <ul className="mt-4 space-y-2">
        <Condition
          label="Alle velden geclassificeerd"
          status={status.gate.velden}
          hint="Een veld zonder categorie is voor niemand opvraagbaar; een ongeclassificeerde MCP levert dus lege antwoorden op."
        />
        <Condition
          label="Minstens één aggregatietool"
          status={status.gate.aggregaties}
          hint="Zonder aggregatie kan de analyse-laag alleen weigeren."
        />
        <Condition
          label="Minstens één rol met commercieel of financieel"
          status={status.gate.rollen}
          hint="Anders is er niemand voor wie de analyse-laag iets kan betekenen."
        />
      </ul>

      {status.onbereikbaar.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted border border-brand-100 bg-surface-muted rounded px-3 py-2">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Kon zich niet melden: {status.onbereikbaar.join(", ")}. Onbereikbaar is
            niet hetzelfde als in orde — deze MCP&apos;s tellen als niet gehaald.
          </span>
        </p>
      )}
    </section>
  );
}

function Condition({
  label,
  status,
  hint,
}: {
  label: string;
  status: { ok: true } | { ok: false; reden: string };
  hint: string;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {status.ok ? (
        <CheckCircle2
          className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-600"
          aria-hidden="true"
        />
      ) : (
        <XCircle
          className="w-4 h-4 flex-shrink-0 mt-0.5 text-alert-500"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0">
        <div className="text-ink">{label}</div>
        <p className="text-xs text-ink-muted mt-0.5">
          {status.ok ? hint : status.reden}
        </p>
      </div>
    </li>
  );
}
