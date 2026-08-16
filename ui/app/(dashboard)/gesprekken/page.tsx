import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { KLANTENSERVICE_MODULE } from "@factumai/agent-core";
import { requireModulePage } from "@/lib/auth/access";
import { cockpitEnv, makeClient } from "@/lib/db";
import { listConversations, countBillableConversations } from "@/lib/conversations";
import { timeAgoNL } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Chatgesprekken. Eén regel per gesprek; klikken opent het verloop.
 *
 * Ook de plek waar de fair-use-teller zichtbaar is — die telt gesprekken, niet
 * berichten, en buiten-domein telt niet mee.
 */
export default async function ConversationsPage() {
  // Gesprekken zijn klantenservice. Wie die afdeling niet heeft, hoort hier
  // niet te komen — ook niet door de URL in te tikken.
  await requireModulePage(KLANTENSERVICE_MODULE.id);

  const period = new Date().toISOString().slice(0, 7);

  let conversations: Awaited<ReturnType<typeof listConversations>> = [];
  let billable = 0;
  let loadError: string | null = null;
  try {
    const client = makeClient(cockpitEnv());
    [conversations, billable] = await Promise.all([
      listConversations(client, { channel: "chat" }),
      countBillableConversations(client, period),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <header className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
        <div className="flex items-center gap-2">
          <MessagesSquare className="w-5 h-5 text-brand-500" aria-hidden="true" />
          <h1 className="font-display text-xl font-semibold text-brand-700">Gesprekken</h1>
        </div>
        <p className="text-sm text-ink-muted mt-0.5">
          {billable} factureerbaar gesprek{billable === 1 ? "" : "ken"} deze maand.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8">
        {loadError ? (
          <code className="text-xs bg-surface-muted px-2 py-1 rounded text-ink-subtle">
            {loadError}
          </code>
        ) : conversations.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            Nog geen chatgesprekken. Open de testwidget op{" "}
            <code className="text-xs">/chat</code> van de agent-Worker.
          </p>
        ) : (
          <ul className="max-w-3xl divide-y divide-brand-50 bg-white border border-brand-100 rounded-lg overflow-hidden">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/gesprekken/${encodeURIComponent(c.id)}`}
                  className="flex items-baseline gap-3 px-4 py-3 hover:bg-brand-50/50 transition-colors"
                >
                  <span className="text-sm text-ink truncate flex-1">
                    {c.contact_email ?? "Anonieme bezoeker"}
                  </span>
                  {!c.billable && (
                    <span className="text-[11px] text-ink-subtle">niet geteld</span>
                  )}
                  <span className="text-xs text-ink-muted whitespace-nowrap">
                    {timeAgoNL(c.last_message_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
