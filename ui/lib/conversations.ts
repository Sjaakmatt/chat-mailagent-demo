import type { CockpitDbClient } from "./tenant-query";
import { CTX } from "./db";

export interface ConversationRow {
  id: string;
  organization_id: string;
  channel: string;
  external_ref: string | null;
  contact_email: string | null;
  billable: boolean;
  started_at: string;
  last_message_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  body: string;
  author: string | null;
  created_at: string;
}

export interface ConversationWithCount extends ConversationRow {
  messageCount: number;
}

/** Gesprekken, nieuwste activiteit eerst. */
export async function listConversations(
  client: CockpitDbClient,
  opts: { channel?: string; limit?: number } = {},
): Promise<ConversationRow[]> {
  const url = client.tableUrl("aios_conversations");
  if (opts.channel) url.searchParams.set("channel", `eq.${opts.channel}`);
  url.searchParams.set("order", "last_message_at.desc");
  url.searchParams.set("limit", String(opts.limit ?? 100));
  const rows = await client.request<ConversationRow[]>(CTX, url, { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

export async function getConversation(
  client: CockpitDbClient,
  id: string,
): Promise<ConversationRow | undefined> {
  const url = client.tableUrl("aios_conversations");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");
  const rows = await client.request<ConversationRow[]>(CTX, url, { method: "GET" });
  return Array.isArray(rows) ? rows[0] : undefined;
}

/**
 * Berichten in chronologische volgorde. Bewust zonder tenant-filter op de
 * berichten zelf: die hangen via een FK aan het gesprek, en dat gesprek is al
 * tenant-gescoped opgehaald. Vandaar de expliciete conversation_id-filter.
 */
export async function listMessages(
  client: CockpitDbClient,
  conversationId: string,
): Promise<MessageRow[]> {
  const url = client.tableUrl("aios_messages");
  url.searchParams.set("conversation_id", `eq.${conversationId}`);
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", "500");
  const rows = await client.request<MessageRow[]>(CTX, url, { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Aantal factureerbare gesprekken in een maand — de fair-use-teller.
 * `period` is JJJJ-MM.
 */
export async function countBillableConversations(
  client: CockpitDbClient,
  period: string,
): Promise<number> {
  const from = `${period}-01`;
  const [y, m] = period.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const url = client.tableUrl("aios_conversations");
  url.searchParams.set("billable", "eq.true");
  url.searchParams.append("started_at", `gte.${from}`);
  url.searchParams.append("started_at", `lt.${next}`);
  url.searchParams.set("select", "id");
  const rows = await client.request<Array<{ id: string }>>(CTX, url, { method: "GET" });
  return Array.isArray(rows) ? rows.length : 0;
}
