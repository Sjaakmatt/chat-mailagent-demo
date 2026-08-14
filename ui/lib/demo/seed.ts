/**
 * Demo-seeder — zet synthetische mails als Signal op de work-bus en ruimt ze
 * naderhand weer op.
 *
 * Emitten gaat via dezelfde `aios_emit_signal`-RPC die de mail-MCP gebruikt:
 * Signal(NEW) + pgmq-enqueue in één transactie, idempotent op de
 * idempotency-key. Een demo twee keer starten levert dus geen dubbele mails op.
 */

import type { CockpitDbClient } from "../tenant-query";
import { DEMO_SCENARIOS, demoSignalPayload, type DemoScenario } from "./scenarios";

/** Prefix op de idempotency-key; ook de sleutel waarop `resetDemo` opruimt. */
const DEMO_KEY_PREFIX = "demo:";

export function demoIdempotencyKey(orgId: string, s: DemoScenario): string {
  return `${DEMO_KEY_PREFIX}${orgId}:${s.key}`;
}

export interface SeedResult {
  seeded: string[];
  skipped: string[];
}

/**
 * Emit de gevraagde scenario's (default: allemaal). Retourneert per scenario of
 * het nieuw was of al bestond — `aios_emit_signal` geeft `enqueued=false` terug
 * bij een bekende idempotency-key.
 */
export async function seedDemo(
  client: CockpitDbClient,
  keys?: string[],
): Promise<SeedResult> {
  const wanted = keys?.length
    ? DEMO_SCENARIOS.filter((s) => keys.includes(s.key))
    : DEMO_SCENARIOS;

  const seeded: string[] = [];
  const skipped: string[] = [];

  // Bewust serieel: een demo is klein en zo blijft de volgorde in de werkbak
  // gelijk aan de volgorde in het paneel.
  for (const s of wanted) {
    const url = client.rpcUrl("aios_emit_signal");
    const rows = await client.request<
      Array<{ signal_id: string; enqueued: boolean }>
    >(client.ctx(), url, {
      method: "POST",
      body: JSON.stringify({
        p_org: client.orgId,
        p_domain: "mail",
        p_type: "mail.received",
        p_payload: demoSignalPayload(s),
        p_idempotency_key: demoIdempotencyKey(client.orgId, s),
      }),
    });
    const enqueued = Array.isArray(rows) ? rows[0]?.enqueued : false;
    if (enqueued) seeded.push(s.key);
    else skipped.push(s.key);
  }

  return { seeded, skipped };
}

/**
 * Ruimt de demo op: eerst de ReviewItems die uit demo-Signals zijn ontstaan,
 * dan de Signals zelf (FK-volgorde). Raakt alleen rijen waarvan de
 * idempotency-key de demo-prefix draagt — echte klantmail blijft gegarandeerd
 * staan, ook als iemand dit per ongeluk op productie aanroept.
 */
export async function resetDemo(client: CockpitDbClient): Promise<number> {
  // 1. De demo-Signals van deze tenant opzoeken.
  const signalsUrl = client.tableUrl("aios_signals");
  signalsUrl.searchParams.set("idempotency_key", `like.${DEMO_KEY_PREFIX}*`);
  signalsUrl.searchParams.set("select", "id");
  const signals = await client.request<Array<{ id: string }>>(
    client.ctx(),
    signalsUrl,
    { method: "GET" },
  );
  const ids = (Array.isArray(signals) ? signals : []).map((r) => r.id);
  if (ids.length === 0) return 0;

  const inList = `(${ids.join(",")})`;

  // 2. ReviewItems die eraan hangen.
  const itemsUrl = client.tableUrl("aios_review_items");
  itemsUrl.searchParams.set("signal_id", `in.${inList}`);
  await client.request<unknown>(client.ctx(), itemsUrl, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  // 3. De Signals zelf.
  const delUrl = client.tableUrl("aios_signals");
  delUrl.searchParams.set("id", `in.${inList}`);
  await client.request<unknown>(client.ctx(), delUrl, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  return ids.length;
}
