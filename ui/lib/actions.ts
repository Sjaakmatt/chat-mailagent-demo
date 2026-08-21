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
  actionTypeBySlug,
  isOpenAction,
  requiredApproverRole,
  type ActionStatus,
  type FieldEvidence,
  type ProposedAction,
} from "@factumai/agent-core";
import type { CockpitDbClient } from "./tenant-query";

/**
 * Een voorstel plus wat de cockpit erbij bewaart.
 *
 * `ProposedAction` uit agent-core kent geen correcties — dat is bewust: de kern
 * beschrijft wat de agent voorstelde, en wie het daarna bijstelde is iets van
 * de werkbak. Hier komt dat bij elkaar.
 */
export interface CockpitAction extends ProposedAction {
  /** Wat de agent voorstelde, zodra een mens iets heeft aangepast. */
  originalPayload: Record<string, unknown> | null;
  editedBy: string | null;
  editedAt: string | null;
  /** Wie het besluit nam. Staat in de database, niet in het kerncontract. */
  decidedBy: string | null;
  decidedAt: string | null;
}

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
  original_payload: Record<string, unknown> | null;
  edited_by: string | null;
  edited_at: string | null;
}

const SELECT =
  "id,organization_id,type,payload,evidence,precondition,impact,status," +
  "signal_id,review_item_id,idempotency_key,reason,decided_by,decided_at," +
  "created_at,expires_at,original_payload,edited_by,edited_at";

function rowToAction(r: ProposedActionRow): CockpitAction {
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
    originalPayload: r.original_payload,
    editedBy: r.edited_by,
    editedAt: r.edited_at,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
  };
}

/** Eén voorstel op id. Null als het niet bestaat binnen deze tenant. */
export async function getProposedAction(
  client: CockpitDbClient,
  id: string,
): Promise<CockpitAction | null> {
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
): Promise<CockpitAction[]> {
  const url = client.tableUrl("aios_proposed_actions");
  url.searchParams.set("signal_id", `eq.${signalId}`);
  url.searchParams.set("select", SELECT);
  url.searchParams.set("order", "created_at.asc");
  const rows = await client.request<ProposedActionRow[]>(CTX, url, {
    method: "GET",
  });
  return Array.isArray(rows) ? rows.map(rowToAction) : [];
}

/**
 * De voorstellen die bij een reeks ReviewItems horen, gegroepeerd per item.
 *
 * Eén query voor de hele ticketlijst in plaats van één per ticket. Bij twintig
 * open tickets is dat het verschil tussen één request en twintig — en die
 * twintig zijn allemaal serieel, want ze hangen aan het renderen van de rij.
 *
 * Hier wél op `review_item_id`: een ticket ontstaat alleen bij uitkomst `taak`,
 * en dan is er per definitie een ReviewItem om aan te hangen.
 */
export async function listActionsByReviewItem(
  client: CockpitDbClient,
  reviewItemIds: readonly string[],
): Promise<Map<string, CockpitAction[]>> {
  const uniek = [...new Set(reviewItemIds.filter(Boolean))];
  if (uniek.length === 0) return new Map();

  const url = client.tableUrl("aios_proposed_actions");
  url.searchParams.set("review_item_id", `in.(${uniek.join(",")})`);
  url.searchParams.set("select", SELECT);
  url.searchParams.set("order", "created_at.asc");
  const rows = await client.request<ProposedActionRow[]>(CTX, url, {
    method: "GET",
  });

  const uit = new Map<string, CockpitAction[]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.review_item_id) continue;
    const lijst = uit.get(row.review_item_id) ?? [];
    lijst.push(rowToAction(row));
    uit.set(row.review_item_id, lijst);
  }
  return uit;
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
  /** Wie het voorstel heeft bijgesteld, als dat is gebeurd. */
  editedBy: string | null;
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
  /** Mag een medewerker dit corrigeren? Uit de registratie. */
  editable: boolean;
  /** Is dit een getal? Bepaalt het invoerveld en de omzetting. */
  numeriek: boolean;
  /**
   * Wat de agent hier oorspronkelijk neerzette, als een mens het heeft
   * aangepast. Null betekent onveranderd — en dan is de dekking hieronder nog
   * die van de agent.
   */
  origineel: string | null;
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
  action: CockpitAction,
  now: Date,
): ActionViewModel {
  const def = actionTypeBySlug(action.type);
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
    editedBy: action.editedBy ?? null,
    // Uit de registratie én de payload: een creditnota boven de drempel vraagt
    // om een beheerder, en dat moet in het scherm staan vóórdat iemand klikt.
    approverRole: def
      ? requiredApproverRole(def, action.payload)
      : "admin",
    fields: bladeren(action.payload).map(({ name, value }) => {
      const veld = (def?.payloadFields ?? []).find((v) => v.name === name);
      // Alleen tonen als het écht anders is. Een origineel dat gelijk is aan de
      // huidige waarde zou "aangepast" suggereren waar niets is gebeurd.
      const oud = action.originalPayload
        ? bladeren(action.originalPayload).find((b) => b.name === name)?.value
        : undefined;
      const veranderd =
        oud !== undefined && JSON.stringify(oud) !== JSON.stringify(value);
      return {
        name,
        label: veld?.label ?? name,
        value: toonWaarde(value),
        editable: veld?.editable === true,
        numeriek: typeof value === "number",
        origineel: veranderd ? toonWaarde(oud) : null,
        toolCallId: dekking.get(name) ?? null,
      };
    }),
    precondition: Object.entries(action.precondition).map(([field, value]) => ({
      field,
      value: toonWaarde(value),
    })),
  };
}
