"use client";

import { Calculator } from "lucide-react";

/**
 * Een cijfer met zijn verantwoording.
 *
 * Regel uit de bouwbriefing: **elk cijfer wordt getoond met periode, populatie
 * en definitie erbij. Standaard zichtbaar, niet uitklapbaar.**
 *
 * Dus niet "jullie klachtenpercentage is 4,2 procent", maar het getal met erbij
 * over welke periode, hoeveel records, wat er is meegeteld en wat eruit is
 * gelaten. Dat leest zwaarder. Doe het toch: een directeur die dit getal in een
 * vergadering gebruikt moet kunnen uitleggen waar het vandaan komt, en jij
 * verkoopt precies dat je geen cijfers verzint.
 *
 * Uitklapbaar maken zou de helft van dat verhaal weer weghalen — wat achter een
 * klik zit, wordt niet gelezen en dus ook niet meegenomen naar die vergadering.
 */

export interface Aggregatie {
  tool: string;
  resultaat: {
    waarde: number;
    eenheid: string;
    periode: { van: string; tot: string };
    populatie: number;
    definitie: string;
    uitgesloten: { aantal: number; reden: string }[];
    queryId: string;
  };
}

const EENHEID_SUFFIX: Record<string, string> = {
  percentage: "%",
  euro: " euro",
  stuks: " stuks",
  dagen: " dagen",
};

/** ISO-datum → 1 juli 2026. */
function datumNL(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * `tot` is exclusief; een lezer denkt in "tot en met". Eén dag eraf zodat er
 * staat wat hij verwacht — met de exacte grens nog in de titel voor wie 'm
 * moet narekenen.
 */
function totEnMet(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() - 1);
  return datumNL(d.toISOString());
}

export function CijferKaart({ aggregatie }: { aggregatie: Aggregatie }) {
  const r = aggregatie.resultaat;
  const suffix = EENHEID_SUFFIX[r.eenheid] ?? ` ${r.eenheid}`;

  return (
    <section className="mt-4 rounded-lg border border-brand-200 bg-brand-50/40 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-baseline gap-2">
          <Calculator
            className="w-3.5 h-3.5 text-brand-500 self-center flex-shrink-0"
            aria-hidden="true"
          />
          <span className="text-2xl font-display font-semibold text-ink tabular-nums">
            {r.waarde.toLocaleString("nl-NL")}
            {suffix}
          </span>
        </div>

        {/* De verantwoording. Standaard zichtbaar — zie de module-doc. */}
        <dl className="mt-2 space-y-1 text-xs text-ink-muted">
          <Regel label="Periode">
            <span title={`${r.periode.van} tot ${r.periode.tot} (tot is exclusief)`}>
              {datumNL(r.periode.van)} t/m {totEnMet(r.periode.tot)}
            </span>
          </Regel>
          <Regel label="Populatie">
            <span className="tabular-nums">{r.populatie.toLocaleString("nl-NL")}</span>{" "}
            records
          </Regel>
          <Regel label="Definitie">{r.definitie}</Regel>
          <Regel label="Uitgesloten">
            {r.uitgesloten.length === 0
              ? "niets"
              : r.uitgesloten
                  .map((u) => `${u.aantal} — ${u.reden}`)
                  .join("; ")}
          </Regel>
        </dl>
      </div>

      <div className="px-4 py-1.5 border-t border-brand-100 bg-white/60">
        <p className="text-[10px] text-ink-subtle font-mono truncate">
          {aggregatie.tool} · {r.queryId}
        </p>
      </div>
    </section>
  );
}

function Regel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-subtle flex-shrink-0 w-20">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
