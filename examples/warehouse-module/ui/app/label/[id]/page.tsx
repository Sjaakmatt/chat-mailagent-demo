import { cockpitEnv, makeClient, getShipmentTask } from "@/lib/db";
import { PrintButton } from "@/components/warehouse/PrintButton";

export const dynamic = "force-dynamic";

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export default async function LabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = safeDecode(raw);

  let task;
  try {
    task = await getShipmentTask(makeClient(cockpitEnv()), id);
  } catch {
    task = undefined;
  }

  if (!task) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 text-sm text-ink-muted">
        Verzendtaak niet gevonden.
      </div>
    );
  }

  const items = Array.isArray(task.items) ? task.items : [];

  return (
    <div className="min-h-screen bg-surface-muted p-6 flex flex-col items-center gap-4">
      <div className="w-full max-w-[420px] flex justify-end print:hidden">
        <PrintButton />
      </div>

      {/* Label */}
      <div className="w-full max-w-[420px] bg-white border-2 border-black rounded-sm overflow-hidden font-sans">
        <div className="flex items-center justify-between px-4 py-2 bg-[#cc0000] text-white">
          <span className="text-lg font-extrabold tracking-tight">PostNL</span>
          <span className="text-[10px] uppercase tracking-widest">Demo-label</span>
        </div>

        <div className="px-4 py-3 border-b-2 border-black">
          <div className="text-[10px] uppercase tracking-wide text-black/60">
            Afzender
          </div>
          <div className="text-sm font-medium">
            Sunwise · Retour onderdelen
          </div>
        </div>

        <div className="px-4 py-3 border-b-2 border-black">
          <div className="text-[10px] uppercase tracking-wide text-black/60">
            Geadresseerde
          </div>
          <div className="text-base font-semibold">
            {task.customer_name ?? task.customer_email ?? "Klant"}
          </div>
          {task.customer_address && (
            <div className="text-sm whitespace-pre-line mt-0.5">
              {task.customer_address}
            </div>
          )}
        </div>

        {/* Barcode (visueel) */}
        <div className="px-4 py-3 border-b-2 border-black">
          <div
            className="h-16 w-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px, #000 4px 5px, #fff 5px 8px, #000 8px 11px, #fff 11px 12px)",
            }}
            aria-hidden="true"
          />
          <div className="text-center font-mono text-sm tracking-widest mt-1">
            {task.label ?? "—"}
          </div>
        </div>

        <div className="px-4 py-3 text-xs">
          {task.order_reference && (
            <div>
              <span className="text-black/60">Order: </span>
              <span className="font-mono">{task.order_reference}</span>
            </div>
          )}
          {items.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wide text-black/60 mb-1">
                Inhoud
              </div>
              <ul className="space-y-0.5">
                {items.map((it, i) => (
                  <li key={i}>
                    <div className="flex justify-between gap-2">
                      <span>
                        {it.quantity ?? 1}× {it.name ?? it.sku ?? "Onderdeel"}
                      </span>
                      {it.sku && (
                        <span className="font-mono text-black/60">{it.sku}</span>
                      )}
                    </div>
                    {Array.isArray(it.batches) &&
                      it.batches.map((b, j) => (
                        <div
                          key={j}
                          className="text-[11px] text-black/60 flex items-center gap-1"
                        >
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: b.color ?? "#999" }}
                          />
                          {b.category ? `${b.category}: ` : ""}
                          {b.label}
                          {b.notes ? ` — ${b.notes}` : ""}
                        </div>
                      ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-ink-subtle max-w-[420px] text-center print:hidden">
        Demo-verzendlabel. Echte PostNL-labels komen later via een mcp-shipping
        koppeling.
      </p>
    </div>
  );
}
