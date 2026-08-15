import type { CockpitDbClient } from "./tenant-query";
import { CTX } from "./db";

/**
 * Feedback van **bezoekers** op chatantwoorden.
 *
 * Niet te verwarren met `feedback.ts`: dat gaat over de beslissing van een
 * medewerker in de werkbak, die als GOOD/BAD-voorbeeld naar de kennisbank gaat.
 * Dit hier is het oordeel van de klant zelf, en dat gaat juist NIET automatisch
 * die kant op — zie hieronder.
 *
 * Feedback van bezoekers op chatantwoorden — de werklijst waaruit eval-cases
 * ontstaan.
 *
 * Een duim omlaag zegt "ontevreden", niet "dit was het goede antwoord". Daarom
 * gaat dit niet automatisch de kennisbank in maar naar dit scherm, waar een
 * mens er één label op zet. Dat label is categorisch en dus in seconden te
 * kiezen, en levert een scherpere testcase op dan vrije tekst.
 *
 * De opmerking van de bezoeker is en blijft DATA. Toon 'm, gebruik 'm om te
 * begrijpen wat er misging, maar zet 'm nergens in een prompt.
 */

export type Rating = "up" | "down";
export type TriageStatus = "NEW" | "LABELED" | "DISMISSED";
export type EvalLabel = "routing" | "gate" | "grounding" | "identity" | "tone" | "other";

/** Wat elk label betekent, voor de knoppen in het scherm. */
export const EVAL_LABELS: ReadonlyArray<{ key: EvalLabel; label: string; uitleg: string }> = [
  { key: "routing", label: "Routering", uitleg: "verkeerde categorie gekozen" },
  { key: "gate", label: "Domeingrens", uitleg: "onterecht geweigerd of doorgelaten" },
  { key: "grounding", label: "Grounding", uitleg: "feit zonder bron, of juist weggelaten" },
  { key: "identity", label: "Identificatie", uitleg: "vroeg om wat al gegeven was" },
  { key: "tone", label: "Toon", uitleg: "klopt, maar niet hoe wij schrijven" },
  { key: "other", label: "Anders", uitleg: "vul in wat het had moeten zijn" },
];

export interface FeedbackRow {
  id: string;
  conversation_id: string;
  message_id: string;
  rating: Rating;
  comment: string | null;
  signal_id: string | null;
  review_item_id: string | null;
  triage_status: TriageStatus;
  eval_label: EvalLabel | null;
  eval_expected: string | null;
  labeled_by: string | null;
  created_at: string;
}

export interface FeedbackItem {
  id: string;
  conversationId: string;
  messageId: string;
  rating: Rating;
  comment: string | null;
  reviewItemId: string | null;
  triageStatus: TriageStatus;
  evalLabel: EvalLabel | null;
  evalExpected: string | null;
  createdAt: string;
  /** Het antwoord waar het over gaat. Los opgehaald; kan ontbreken. */
  answer?: string;
  /** De vraag ervoor, voor zover te bepalen. */
  question?: string;
}

function toItem(r: FeedbackRow): FeedbackItem {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    rating: r.rating,
    comment: r.comment,
    reviewItemId: r.review_item_id,
    triageStatus: r.triage_status,
    evalLabel: r.eval_label,
    evalExpected: r.eval_expected,
    createdAt: r.created_at,
  };
}

/**
 * De werklijst. Standaard alleen wat nog niet beoordeeld is, want dat is waar
 * iemand iets mee moet — de rest is archief.
 */
export async function listFeedback(
  client: CockpitDbClient,
  opts: { status?: TriageStatus; limit?: number } = {},
): Promise<FeedbackItem[]> {
  const url = client.tableUrl("aios_message_feedback");
  if (opts.status) url.searchParams.set("triage_status", `eq.${opts.status}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(opts.limit ?? 100));
  const rows = await client.request<FeedbackRow[]>(CTX, url, { method: "GET" });
  const items = (Array.isArray(rows) ? rows : []).map(toItem);
  if (items.length === 0) return items;

  // De berichten erbij: het antwoord waar de duim op ging, en de vraag ervoor.
  // In één query voor het hele gesprek, want per item ophalen zou N rondjes
  // kosten voor een lijst die je in één blik wilt kunnen lezen.
  const gesprekken = [...new Set(items.map((i) => i.conversationId))];
  const msgUrl = client.tableUrl("aios_messages");
  msgUrl.searchParams.set("conversation_id", `in.(${gesprekken.join(",")})`);
  msgUrl.searchParams.set("select", "id,conversation_id,direction,body,created_at");
  msgUrl.searchParams.set("order", "created_at.asc");
  const berichten = await client.request<
    Array<{
      id: string;
      conversation_id: string;
      direction: string;
      body: string;
      created_at: string;
    }>
  >(CTX, msgUrl, { method: "GET" });

  const perGesprek = new Map<string, typeof berichten>();
  for (const b of Array.isArray(berichten) ? berichten : []) {
    const lijst = perGesprek.get(b.conversation_id) ?? [];
    lijst.push(b);
    perGesprek.set(b.conversation_id, lijst);
  }

  return items.map((item) => {
    const lijst = perGesprek.get(item.conversationId) ?? [];
    const index = lijst.findIndex((b) => b.id === item.messageId);
    if (index === -1) return item;
    // De laatste vraag vóór dit antwoord. Zonder die vraag is een oordeel over
    // het antwoord niet te beoordelen.
    const vraag = [...lijst.slice(0, index)].reverse().find((b) => b.direction === "inbound");
    return { ...item, answer: lijst[index].body, question: vraag?.body };
  });
}

/**
 * Zet het oordeel van de medewerker erop. `DISMISSED` bewaart de rij maar haalt
 * 'm uit de werklijst — een chagrijnige bezoeker is geen testcase, en dat is
 * ook informatie.
 */
export async function labelFeedback(
  client: CockpitDbClient,
  id: string,
  input: { status: TriageStatus; label?: EvalLabel | null; expected?: string | null },
  actor: string | null,
): Promise<void> {
  const url = client.tableUrl("aios_message_feedback");
  url.searchParams.set("id", `eq.${id}`);
  await client.request<unknown>(CTX, url, {
    method: "PATCH",
    body: JSON.stringify({
      triage_status: input.status,
      eval_label: input.label ?? null,
      eval_expected: input.expected?.trim() || null,
      labeled_by: actor,
      updated_at: new Date().toISOString(),
    }),
    prefer: "return=minimal",
  });
}
