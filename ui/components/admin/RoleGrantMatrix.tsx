import { Info } from "lucide-react";
import {
  DATA_CATEGORIES,
  resolveAccess,
  type DataCategory,
  type Role,
  type RoleGrant,
} from "@factumai/agent-core";
import { MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

/**
 * Wat elke rol mag zien, per proces.
 *
 * Lezen, niet bewerken. Dat is bewust: de matrix is er om te kunnen
 * controleren of de rechten kloppen — de vraag "ziet mijn klantenservice
 * echt geen marges?" moet je kunnen beantwoorden zonder de database open te
 * trekken. Instellen gebeurt vandaag in `aios_role_grants`; een editor komt
 * pas als de vorm zich bij een tweede module bewezen heeft.
 */

const ROLE_ORDER: Role[] = ["viewer", "reviewer", "admin"];

const ROLE_LABELS: Record<Role, string> = {
  viewer: "Kijker",
  reviewer: "Medewerker",
  admin: "Beheerder",
};

const CATEGORY_LABELS: Record<DataCategory, string> = {
  operationeel: "Operationeel",
  commercieel: "Commercieel",
  financieel: "Financieel",
};

const CATEGORY_HINTS: Record<DataCategory, string> = {
  operationeel: "Orderstatus, voorraad, verzending, tickets, doorlooptijden",
  commercieel: "Klantomzet, bestelfrequentie, orderwaarde, kortingen, prijsafspraken",
  financieel: "Inkoopprijzen, marges, kostprijzen, betaalgedrag, openstaande posten",
};

export function RoleGrantMatrix({
  grants,
  usingDefaults,
}: {
  grants: RoleGrant[];
  /** Geen rijen in de database → het standaardvoorstel uit agent-core. */
  usingDefaults: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-brand-700">
        Wat elke rol mag zien
      </h2>
      <p className="text-sm text-ink-muted mt-1">
        Dezelfde rol die bepaalt wat iemand mag goedkeuren, bepaalt wat hij mag
        opvragen. Een veld zonder categorie is voor niemand opvraagbaar, ook niet
        voor een beheerder.
      </p>

      {usingDefaults && (
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted border border-brand-100 bg-surface-muted rounded px-3 py-2">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Er staat nog niets ingesteld voor deze organisatie; dit is het
            standaardvoorstel. Wijk je ervan af, dan zet je dat in{" "}
            <code className="text-[11px]">aios_role_grants</code>.
          </span>
        </p>
      )}

      <div className="mt-4 space-y-6">
        {MODULES.map((mod) => (
          <div key={mod.id}>
            {MODULES.length > 1 && (
              <h3 className="text-sm font-medium text-ink mb-2">{mod.label}</h3>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-brand-100 rounded-lg overflow-hidden">
                <thead className="bg-surface-muted">
                  <tr>
                    <th className="text-left font-medium text-ink-muted px-3 py-2">
                      Rol
                    </th>
                    {DATA_CATEGORIES.map((cat) => (
                      <th
                        key={cat}
                        className="text-left font-medium text-ink-muted px-3 py-2"
                        title={CATEGORY_HINTS[cat]}
                      >
                        {CATEGORY_LABELS[cat]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROLE_ORDER.map((role) => {
                    const access = resolveAccess(role, grants);
                    const mayEnter = access.mayEnter(mod.id);
                    const allowed = access.categoriesIn(mod.id);
                    return (
                      <tr key={role} className="border-t border-brand-50">
                        <td className="px-3 py-2 text-ink">
                          {ROLE_LABELS[role]}
                          {!mayEnter && (
                            <span className="ml-2 text-xs text-ink-subtle">
                              geen toegang tot dit proces
                            </span>
                          )}
                        </td>
                        {DATA_CATEGORIES.map((cat) => (
                          <td key={cat} className="px-3 py-2">
                            <Mark on={allowed.includes(cat)} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Mark({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
        on
          ? "text-green-700 border-green-200 bg-green-50"
          : "text-ink-subtle border-brand-100 bg-white",
      )}
    >
      {on ? "ja" : "nee"}
    </span>
  );
}
