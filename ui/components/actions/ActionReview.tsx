"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  Database,
  ShieldAlert,
  X,
} from "lucide-react";
import type { ActionViewModel } from "@/lib/actions";
import { cn } from "@/lib/utils";

/**
 * De controle vóór er iets in een bronsysteem wordt geschreven.
 *
 * Dit scherm bestaat om één vraag beantwoordbaar te maken: *waar zegt deze
 * medewerker ja tegen?* Daarom staat de impact-zin groot en de payload klein,
 * en staat bij elk veld de tool-call die de waarde dekt. Een creditnota van
 * € 89,95 goedkeuren zonder te kunnen zien waar de 89,95 vandaan komt, is
 * precies het aftekenen dat de goedkeuringslaag zinloos maakt.
 *
 * Wat hier bewust **niet** kan: de payload aanpassen. Een voorstel is een
 * voorstel van de agent, met onderbouwing per veld; een veld met de hand
 * overschrijven maakt die onderbouwing een leugen. Klopt het niet, dan wijs je
 * af met een reden — dat is meteen het beste leersignaal dat we hebben.
 */
export function ActionReview({ actions }: { actions: ActionViewModel[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (actions.length === 0) return null;

  const actief = actions.find((a) => a.id === open) ?? null;

  return (
    <div className="space-y-2">
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => setOpen(a.id)}
          className={cn(
            "w-full text-left rounded-lg border px-3 py-2.5",
            "hover:bg-brand-50/40 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
            a.open ? "border-bucket-review/40" : "border-border",
          )}
        >
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-ink-subtle flex-shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold text-ink flex-1 min-w-0 truncate">
              {a.typeLabel}
            </span>
            <StatusChip vm={a} />
            <ChevronRight className="w-4 h-4 text-ink-subtle flex-shrink-0" aria-hidden="true" />
          </div>
          <p className="mt-1 text-sm text-ink-muted">{a.impact}</p>
        </button>
      ))}

      {actief && <ActionDialog vm={actief} onClose={() => setOpen(null)} />}
    </div>
  );
}

function StatusChip({ vm }: { vm: ActionViewModel }) {
  const [label, klasse] = chipFor(vm);
  return (
    <span
      className={cn(
        "text-xs px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0",
        klasse,
      )}
    >
      {label}
    </span>
  );
}

function chipFor(vm: ActionViewModel): [string, string] {
  if (vm.status === "uitgevoerd") return ["Uitgevoerd", "bg-green-100 text-green-800"];
  if (vm.status === "afgewezen") return ["Afgewezen", "bg-surface-muted text-ink-muted"];
  if (vm.status === "verlopen") return ["Verlopen", "bg-surface-muted text-ink-muted"];
  if (vm.status === "mislukt") return ["Mislukt", "bg-alert-50 text-alert-600"];
  if (vm.status === "goedgekeurd") return ["Wordt uitgevoerd", "bg-brand-50 text-brand-700"];
  if (vm.expired) return ["Verlopen", "bg-surface-muted text-ink-muted"];
  return ["Wacht op controle", "bg-bucket-review/10 text-bucket-review"];
}

function ActionDialog({
  vm,
  onClose,
}: {
  vm: ActionViewModel;
  onClose: () => void;
}) {
  const router = useRouter();
  const [bezig, setBezig] = useState<"approve" | "reject" | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [reden, setReden] = useState("");

  // Verlopen telt als niet-beslisbaar, ook als de status nog 'voorgesteld' is.
  // De knop grijs maken is eerlijker dan een klik die achteraf afketst.
  const beslisbaar = vm.open && !vm.expired;

  async function beslis(actie: "approve" | "reject") {
    setBezig(actie);
    setFout(null);
    try {
      const res = await fetch(`/api/actions/${vm.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actie, reason: reden || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFout(data.error ?? "Er ging iets mis.");
        return;
      }
      // De waarheid staat in de rij, niet in dit venster. Verversen en sluiten.
      router.refresh();
      onClose();
    } catch (err) {
      setFout(err instanceof Error ? err.message : String(err));
    } finally {
      setBezig(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Controle: ${vm.typeLabel}`}
      onClick={onClose}
    >
      <div
        className="bg-surface w-full sm:max-w-2xl sm:rounded-xl max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 p-5 border-b border-border sticky top-0 bg-surface">
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">
              {vm.typeLabel}
            </h2>
            {/* De impact-zin, groot. Dit is waar iemand ja tegen zegt. */}
            <p className="mt-1 text-sm text-ink">{vm.impact}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sluiten"
            className="p-1 rounded hover:bg-surface-muted text-ink-subtle"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {vm.approverRole === "admin" && (
            <Melding
              icon={<ShieldAlert className="w-4 h-4" aria-hidden="true" />}
              toon="waarschuwing"
            >
              Dit voorstel vraagt om een beheerder — het bedrag ligt boven de
              grens die een medewerker zelf mag aftekenen.
            </Melding>
          )}

          {vm.expired && vm.open && (
            <Melding
              icon={<Clock className="w-4 h-4" aria-hidden="true" />}
              toon="waarschuwing"
            >
              Dit voorstel is verlopen. De situatie kan sinds het opstellen zijn
              veranderd; laat de agent er een nieuw voorstel voor maken.
            </Melding>
          )}

          {vm.reason && (
            <Melding
              icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}
              toon={vm.status === "uitgevoerd" ? "neutraal" : "waarschuwing"}
            >
              {vm.reason}
            </Melding>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle mb-2">
              Wat er wordt weggeschreven
            </h3>
            <dl className="divide-y divide-border rounded-lg border border-border">
              {vm.fields.map((f) => (
                <div key={f.name} className="flex gap-3 px-3 py-2">
                  <dt className="text-sm text-ink-muted w-40 flex-shrink-0">
                    {f.label}
                  </dt>
                  <dd className="text-sm text-ink flex-1 min-w-0 break-words">
                    {f.value}
                    {/* De dekking per veld. Ontbreekt hij, dan hoort dat op te
                        vallen — zo'n voorstel komt normaal niet eens tot hier. */}
                    <span
                      className={cn(
                        "ml-2 text-xs",
                        f.toolCallId ? "text-ink-subtle" : "text-alert-600",
                      )}
                    >
                      {f.toolCallId ? `← ${f.toolCallId}` : "← geen dekking"}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {vm.precondition.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle mb-2">
                Waarop dit voorstel is gebaseerd
              </h3>
              <p className="text-xs text-ink-muted mb-2">
                Bij goedkeuren wordt dit opnieuw opgehaald. Is het intussen
                veranderd, dan wordt er niets weggeschreven.
              </p>
              <dl className="divide-y divide-border rounded-lg border border-border">
                {vm.precondition.map((p) => (
                  <div key={p.field} className="flex gap-3 px-3 py-2">
                    <dt className="text-sm text-ink-muted w-40 flex-shrink-0">
                      {p.field}
                    </dt>
                    <dd className="text-sm text-ink">{p.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {beslisbaar && (
            <section className="space-y-2">
              <label
                htmlFor={`reden-${vm.id}`}
                className="block text-xs font-semibold uppercase tracking-wide text-ink-subtle"
              >
                Reden bij afwijzen
              </label>
              <textarea
                id={`reden-${vm.id}`}
                value={reden}
                onChange={(e) => setReden(e.target.value)}
                rows={2}
                placeholder="Waarom klopt dit voorstel niet? Dit is wat de agent ervan leert."
                className="w-full text-sm rounded-lg border border-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </section>
          )}

          {fout && (
            <Melding
              icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}
              toon="fout"
            >
              {fout}
            </Melding>
          )}
        </div>

        {beslisbaar && (
          <footer className="flex gap-2 p-5 border-t border-border sticky bottom-0 bg-surface">
            <button
              type="button"
              disabled={bezig !== null}
              onClick={() => beslis("approve")}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              {bezig === "approve" ? "Bezig…" : "Goedkeuren en wegschrijven"}
            </button>
            <button
              type="button"
              disabled={bezig !== null}
              onClick={() => beslis("reject")}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-muted disabled:opacity-50"
            >
              {bezig === "reject" ? "Bezig…" : "Afwijzen"}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function Melding({
  icon,
  toon,
  children,
}: {
  icon: React.ReactNode;
  toon: "waarschuwing" | "fout" | "neutraal";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
        toon === "fout" && "bg-alert-50 text-alert-600",
        toon === "waarschuwing" && "bg-bucket-review/10 text-ink",
        toon === "neutraal" && "bg-surface-muted text-ink-muted",
      )}
    >
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
