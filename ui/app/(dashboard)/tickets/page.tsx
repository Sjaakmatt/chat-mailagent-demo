import { ClipboardList } from "lucide-react";
import { KLANTENSERVICE_MODULE, type Ticket } from "@factumai/agent-core";
import { requireModulePage } from "@/lib/auth/access";
import { cockpitEnv, makeClient } from "@/lib/db";
import { listTickets } from "@/lib/tickets";
import {
  listActionsByReviewItem,
  toActionViewModel,
  type ActionViewModel,
} from "@/lib/actions";
import { TicketList } from "@/components/tickets/TicketList";

export const dynamic = "force-dynamic";

/**
 * Werkbak, modus **afhandelen** (bouwbriefing §5).
 *
 * Waar de mail-werkbak gaat over goedkeuren van een concept, gaat dit over
 * uitzoekwerk: oppakken, uitzoeken, antwoorden, sluiten. Zelfde onderliggende
 * gedachte, andere handeling — vandaar een eigen scherm en niet een filter op
 * de bestaande werkbak.
 */
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  // Tickets zijn klantenservice. De guard dekt allebei de gevallen die hier
  // fout kunnen gaan: geen sessie (→ aanmelden) en wél een sessie maar niet
  // deze afdeling (→ terug naar de werkbak). Het losse "log in"-scherm dat
  // hier stond, dekte alleen het eerste.
  const user = await requireModulePage(KLANTENSERVICE_MODULE.id);

  // Welk ticket de bezoeker komt halen. Het werkitem linkt hierheen met het id
  // erbij; zonder dat moet iemand met dertig open tickets zelf gaan zoeken naar
  // het ticket waar hij net vandaan kwam.
  const focus = (await searchParams).focus ?? null;

  let tickets: Ticket[] = [];
  let loadError: string | null = null;
  // Eén query voor de hele lijst, niet één per ticket: bij twintig open tickets
  // is dat het verschil tussen één request en twintig seriële.
  let actionsByReviewItem: Record<string, ActionViewModel[]> = {};
  try {
    const client = makeClient(cockpitEnv());
    tickets = await listTickets(client);
    const nu = new Date();
    const perItem = await listActionsByReviewItem(
      client,
      tickets.map((t) => t.reviewItemId).filter((id): id is string => Boolean(id)),
    );
    actionsByReviewItem = Object.fromEntries(
      [...perItem].map(([id, acties]) => [id, acties.map((a) => toActionViewModel(a, nu))]),
    );
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  // Afgehandelde tickets blijven een week zichtbaar; ouder verdwijnt uit beeld
  // (de auditlog houdt ze). Open werk blijft altijd staan.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const isRecent = (t: Ticket) => Date.parse(t.closedAt ?? t.createdAt) >= cutoff;

  const open = tickets.filter((t) => t.status === "OPEN");
  const bezig = tickets.filter((t) => t.status === "IN_PROGRESS");
  const afgerond = tickets.filter(
    (t) => (t.status === "DONE" || t.status === "CANCELLED") && isRecent(t),
  );

  return (
    <>
      <PageHeader open={open.length + bezig.length} />
      <div className="flex-1 overflow-y-auto p-4 sm:p-8">
        {loadError ? (
          <div className="max-w-md">
            <h2 className="font-display text-lg font-semibold text-alert-600 mb-1">
              Kon tickets niet laden
            </h2>
            <code className="text-xs bg-surface-muted px-2 py-1 rounded text-ink-subtle">
              {loadError}
            </code>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <TicketList
              focus={focus}
              actionsByReviewItem={actionsByReviewItem}
              title="Open"
              description="Nog niemand mee bezig"
              tone="review"
              tickets={open}
              role={user.role}
            />
            <TicketList
              focus={focus}
              actionsByReviewItem={actionsByReviewItem}
              title="Opgepakt"
              description="Iemand is ermee bezig"
              tone="progress"
              tickets={bezig}
              role={user.role}
            />
            <TicketList
              focus={focus}
              actionsByReviewItem={actionsByReviewItem}
              title="Afgerond"
              description="Laatste 7 dagen"
              tone="done"
              tickets={afgerond}
              role={user.role}
              compact
            />
          </div>
        )}
      </div>
    </>
  );
}

function PageHeader({ open }: { open: number }) {
  return (
    <header className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-brand-500" aria-hidden="true" />
        <h1 className="font-display text-xl font-semibold text-brand-700">Tickets</h1>
      </div>
      <p className="text-sm text-ink-muted mt-0.5">
        {open > 0
          ? `${open} ticket${open === 1 ? "" : "s"} wacht${open === 1 ? "" : "en"} op afhandeling.`
          : "Geen openstaande tickets."}
      </p>
    </header>
  );
}
