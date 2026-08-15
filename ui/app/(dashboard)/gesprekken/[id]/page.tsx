import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { cockpitEnv, makeClient } from "@/lib/db";
import { getConversation, listMessages } from "@/lib/conversations";
import { listTickets } from "@/lib/tickets";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Het verloop van één chatgesprek, met de tickets die eruit zijn ontstaan.
 *
 * Bewust een eigen scherm en niet het maildetail: een gesprek heeft geen
 * onderwerp, geen thread en geen bijlagen, maar wel een volgorde en een
 * tegenpartij die zit te wachten.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = makeClient(cockpitEnv());

  const conversation = await getConversation(client, id);
  if (!conversation) notFound();

  const [messages, allTickets] = await Promise.all([
    listMessages(client, id),
    listTickets(client),
  ]);
  const tickets = allTickets.filter((t) => t.conversationId === id);

  return (
    <>
      <header className="bg-white border-b border-brand-100 px-4 sm:px-8 py-5">
        <Link
          href="/gesprekken"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-brand-700 mb-2"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Gesprekken
        </Link>
        <div className="flex items-center gap-2">
          <MessagesSquare className="w-5 h-5 text-brand-500" aria-hidden="true" />
          <h1 className="font-display text-xl font-semibold text-brand-700">
            {conversation.contact_email ?? "Anonieme bezoeker"}
          </h1>
        </div>
        <p className="text-sm text-ink-muted mt-0.5">
          {messages.length} bericht{messages.length === 1 ? "" : "en"}
          {!conversation.billable && " · telt niet mee voor fair use"}
        </p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-3xl space-y-6">
          {tickets.length > 0 && (
            <div className="rounded-lg border border-brand-100 bg-white p-4">
              <h2 className="text-xs font-medium text-ink-subtle uppercase tracking-wide mb-2">
                Tickets uit dit gesprek
              </h2>
              <ul className="space-y-1">
                {tickets.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2 text-sm">
                    <code className="text-xs font-medium text-brand-700">{t.number}</code>
                    <span className="text-ink truncate">{t.summary}</span>
                    <span className="text-xs text-ink-subtle ml-auto">{t.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-brand-100 bg-white p-4 space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-ink-subtle">Nog geen berichten.</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[82%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                    m.direction === "inbound"
                      ? "bg-surface-muted border border-brand-100"
                      : "ml-auto bg-accent-500 text-white",
                  )}
                >
                  {m.body}
                  <div
                    className={cn(
                      "text-[11px] mt-1",
                      m.direction === "inbound" ? "text-ink-subtle" : "text-white/70",
                    )}
                  >
                    {m.direction === "inbound" ? "bezoeker" : (m.author ?? "agent")}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
