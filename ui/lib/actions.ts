/**
 * Klaargezette schrijfoperaties, voor het goedkeurscherm.
 *
 * De regels over wát mag — welk type op welk kanaal, welke identificatie, wie
 * mag goedkeuren, wanneer een voorstel verloopt — staan in agent-core
 * (`actions/`) en zijn daar getest. Dit bestand doet de query en de vertaling
 * naar iets dat een scherm kan tekenen.
 *
 * De payload wordt hier bewust **niet** platgeslagen tot tekst. Een medewerker
 * die een creditnota goedkeurt, moet per veld kunnen zien waar de waarde
 * vandaan komt; dat is precies wat `evidence` vastlegt en wat verdwijnt zodra
 * je er één zin van maakt.
 */

import {
  getActionType,
  isOpenAction,
  requiredApproverRole,
  type ActionStatus,
  type FieldEvidence,
  type ProposedAction,
} from "@factumai/agent-core";
import type { CockpitDbClient } from "./tenant-query";

const CTX = {
  organizationId: "_aios",
  agentId: "aios-cockpit",
  toolCallId: "aios-cockpit",
};

interface ProposedActionRow {
  id: string;
  organization_id: string;
  type: string;
  payload: Record<string, unknown>;
  evidence: FieldEvidence[] | null;
  precondition: Record<string, unknown> | null;
  impact: string;
  status: ActionStatus;
  signal_id: string;
  review_item_id: string | null;
  idempotency_key: string;
  reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  expires_at: string;
}

const SELECT =
  "id,organization_id,type,payload,evidence,precondition,impact,status," +
  "signal_id,review_item_id,idempotency_key,reason,decided_by,decided_at," +
  "created_at,expires_at";

function rowToAction(r: ProposedActionRow): ProposedAction {
  return {
    id: r.id,
    organizationId: r.organization_id,
    type: r.type,
    payload: r.payload ?? {},
    evidence: r.evidence ?? [],
    precondition: r.precondition ?? {},
    impact: r.impact,
    status: r.status,
    runId: r.signal_id,
    reviewItemId: r.review_item_id,
    idempotencyKey: r.idempotency_key,
    reason: r.reason,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

/** Eén voorstel op id. Null als het niet bestaat binnen deze tenant. */
export async function getProposedAction(
  client: CockpitDbClient,
  id: string,
): Promise<ProposedAction | null> {
  const url = client.tableUrl("aios_proposed_actions");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("select", SELECT);
  url.searchParams.set("limit", "1");
  const rows = await client.request<ProposedActionRow[]>(CTX, url, {
    method: "GET",
  });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? rowToAction(row) : null;
}

/**
 * Alle voorstellen uit één run.
 *
 * Op `signal_id` en niet op `review_item_id`, want een actie kan bestaan zonder
 * concept-antwoord. Zoeken op het ReviewItem zou juist die gevallen missen —
 * en dat zijn de gevallen waarin er alléén iets te doen valt.
 */
export async function listActionsForRun(
  client: CockpitDbClient,
  signalId: string,
): Promise<ProposedAction[]> {
  const url = client.tableUrl("aios_proposed_actions");
  url.searchParams.set("signal_id", `eq.${signalId}`);
  url.searchParams.set("select", SELECT);
  url.searchParams.set("order", "created_at.asc");
  const rows = await client.request<ProposedActionRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows.map(rowToAction) : [];
}

/** Wat het scherm van één voorstel toont. */
export interface ActionViewModel {
  id: string;
  /** Label uit de registratie, of de ruwe slug als het type is verdwenen. */
  typeLabel: string;
  impact: string;
  status: ActionStatus;
  /** Wacht hier nog iets van een mens? */
  open: boolean;
  /** Verlopen op moment van tonen — ook als de status nog 'voorgesteld' is. */
  expired: boolean;
  expiresAt: string;
  reason: string | null;
  /** Welke rol dit mag goedkeuren, inclusief de bedragsgrens. */
  approverRole: "reviewer" | "admin";
  /** Per payload-veld: label, waarde en waar het vandaan komt. */
  fields: ActionFieldViewModel[];
  /** De systeemstaat waarop dit voorstel is gebaseerd. */
  precondition: { field: string; value: string }[];
}

export interface ActionFieldViewModel {
  /** Puntnotatie, zoals in de payload en de evidence. */
  name: string;
  /** Kop uit de registratie; valt terug op de ruwe naam. */
  label: string;
  value: string;
  /**
   * De tool-call die deze waarde dekt. Null betekent ongedekt — dat hoort niet
   * te kunnen, want zo'n voorstel komt niet door `buildProposedActions`. Staat
   * er tóch null, dan is dat iets om te zien en niet om te verbergen.
   */
  toolCallId: string | null;
}

function toonWaarde(waarde: unknown): string {
  if (waarde === null || waarde === undefined) return "—";
  if (typeof waarde === "string") return waarde;
  return JSON.stringify(waarde);
}

/** Slaat een geneste payload plat tot puntnotatie — zelfde vorm als evidence. */
function bladeren(
  waarde: unknown,
  prefix = "",
): { name: string; value: unknown }[] {
  if (Array.isArray(waarde)) {
    return waarde.flatMap((v, i) =>
      bladeren(v, prefix ? `${prefix}.${i}` : String(i)),
    );
  }
  if (waarde !== null && typeof waarde === "object") {
    const entries = Object.entries(waarde as Record<string, unknown>);
    if (entries.length === 0) return prefix ? [{ name: prefix, value: {} }] : [];
    return entries.flatMap(([k, v]) =>
      bladeren(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return prefix ? [{ name: prefix, value: waarde }] : [];
}

/**
 * Vertaalt een voorstel naar wat het scherm toont.
 *
 * `now` komt binnen in plaats van dat deze functie de klok leest, zodat de
 * server-render en een test hetzelfde antwoord geven.
 */
export function toActionViewModel(
  action: ProposedAction,
  now: Date,
): ActionViewModel {
  const def = getActionType(action.type);
  const dekking = new Map(action.evidence.map((e) => [e.field, e.toolCallId]));
  const labels = new Map((def?.payloadFields ?? []).map((v) => [v.name, v.label]));

  return {
    id: action.id,
    typeLabel: def?.label ?? action.type,
    impact: action.impact,
    status: action.status,
    open: isOpenAction(action.status),
    expired: new Date(action.expiresAt).getTime() <= now.getTime(),
    expiresAt: action.expiresAt,
    reason: action.reason ?? null,
    // Uit de registratie én de payload: een creditnota boven de drempel vraagt
    // om een beheerder, en dat moet in het scherm staan vóórdat iemand klikt.
    approverRole: def
      ? requiredApproverRole(def, action.payload)
      : "admin",
    fields: bladeren(action.payload).map(({ name, value }) => ({
      name,
      label: labels.get(name) ?? name,
      value: toonWaarde(value),
      toolCallId: dekking.get(name) ?? null,
    })),
    precondition: Object.entries(action.precondition).map(([field, value]) => ({
      field,
      value: toonWaarde(value),
    })),
  };
}
