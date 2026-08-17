import { NextResponse } from "next/server";
import {
  getActionType,
  isExpired,
  isOpenAction,
  requiredApproverRole,
} from "@factumai/agent-core";
import { cockpitEnv, makeClient } from "@/lib/db";
import { getProposedAction } from "@/lib/actions";
import { requireRole } from "@/lib/auth/require-role";
import { accessFor } from "@/lib/auth/access";
import { moduleForRow } from "@/lib/modules";
import { getReviewItem } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ActionDecisionBody {
  action: "approve" | "reject";
  /** Bij afwijzen: waarom. Het beste leersignaal dat we hebben. */
  reason?: string;
}

/**
 * Goedkeuren of afwijzen van één klaargezette schrijfoperatie.
 *
 * ## Wat hier wél en niet wordt beslist
 *
 * Deze route toetst wat ze kán weten: is er een sessie, mag deze persoon in deze
 * module, heeft hij de rang die dít type vraagt (inclusief de bedragsgrens), en
 * staat het voorstel nog open.
 *
 * Wat ze **niet** doet is het voorstel op `goedgekeurd` zetten. De volledige
 * toets is `evaluateApproval`, en die heeft de actuele systeemstaat nodig — een
 * lookup die in de agent leeft en niet hier. Zou deze route de status alvast
 * verzetten en de rest aan de Workflow laten, dan is één controle opgeknipt over
 * twee plekken, en dan is er een plek die er een vergeet.
 *
 * Dus: de route laat door of houdt tegen, en de Workflow beslist en schrijft.
 * Afwijzen gaat wél direct, want daar verandert niets in een bronsysteem.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("reviewer");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  let payload: ActionDecisionBody;
  try {
    payload = (await request.json()) as ActionDecisionBody;
  } catch {
    return NextResponse.json({ error: "Ongeldige body" }, { status: 400 });
  }
  if (payload.action !== "approve" && payload.action !== "reject") {
    return NextResponse.json({ error: "Onbekende actie" }, { status: 400 });
  }

  const env = cockpitEnv();
  const client = makeClient(env);
  const action = await getProposedAction(client, id);
  if (!action) {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }

  // De module van het bijbehorende concept-antwoord bepaalt of deze medewerker
  // hier überhaupt over gaat. Een salesmedewerker met genoeg rang mag geen
  // creditnota in klantenservice goedkeuren.
  const me = await accessFor(guard);
  if (action.reviewItemId) {
    const item = await getReviewItem(client, action.reviewItemId);
    const mod = item ? moduleForRow(item) : null;
    if (mod && !me.access.mayEnter(mod.id)) {
      return NextResponse.json(
        { error: "Forbidden", reason: "module" },
        { status: 403 },
      );
    }
  }

  if (!isOpenAction(action.status)) {
    // Al besloten. Geen fout maar ook geen tweede besluit — de status zegt wat
    // er is gebeurd, en die geven we terug zodat het scherm bijtrekt.
    return NextResponse.json(
      { error: "Dit voorstel is al afgehandeld", status: action.status },
      { status: 409 },
    );
  }

  if (payload.action === "reject") {
    await patchAction(client, id, {
      status: "afgewezen",
      reason: payload.reason?.trim() || null,
      decided_by: guard.email,
      decided_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, status: "afgewezen" });
  }

  // ---- goedkeuren ----

  if (isExpired(action, new Date())) {
    // Vroeg afvangen zodat de medewerker het meteen ziet. De Workflow toetst
    // het nog een keer, want tussen deze regel en de schrijfactie zit tijd.
    await patchAction(client, id, {
      status: "verlopen",
      reason: "het voorstel was over de geldigheidsdatum",
      decided_by: guard.email,
      decided_at: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: "Dit voorstel is verlopen", status: "verlopen" },
      { status: 409 },
    );
  }

  const def = getActionType(action.type);
  if (!def) {
    return NextResponse.json(
      { error: "Dit actietype bestaat niet meer" },
      { status: 409 },
    );
  }

  // De grens hoort bij het type en het bedrag, niet bij de gebruiker: een
  // creditnota onder de drempel mag door een medewerker, erboven niet.
  const nodig = requiredApproverRole(def, action.payload);
  if (nodig === "admin" && me.role !== "admin") {
    return NextResponse.json(
      { error: "Dit voorstel vraagt om een beheerder", reason: "rang" },
      { status: 403 },
    );
  }

  try {
    await env.ACTION_EXECUTE.create({
      // Afgeleid van het actie-id: een tweede klik of een dubbel tabblad levert
      // geen tweede run op.
      id: `act-${action.id}`,
      params: {
        actionId: action.id,
        approverRole: me.role,
        approvedBy: guard.email,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Bestaat de instance al, dan is er niets mis: de eerste klik draait al.
    if (!/already exists|instance.*exists/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  // Bewust geen "uitgevoerd" terug. Op dit moment is er nog niets geschreven;
  // de Workflow hervalideert en doet het werk. Het scherm ververst zichzelf op
  // de status van de rij — dat is de enige plek waar de waarheid staat.
  return NextResponse.json({ ok: true, status: "in behandeling" });
}

/** Kleine PATCH-helper; alleen voor besluiten die géén bronsysteem raken. */
async function patchAction(
  client: ReturnType<typeof makeClient>,
  id: string,
  velden: Record<string, unknown>,
): Promise<void> {
  const url = client.tableUrl("aios_proposed_actions");
  url.searchParams.set("id", `eq.${id}`);
  // Alleen zolang er nog niets is besloten. Zonder deze voorwaarde kan een
  // trage tweede request een besluit overschrijven dat er al lag.
  url.searchParams.set("status", "in.(voorgesteld,mislukt)");
  await client.request<unknown>(
    { organizationId: "_aios", agentId: "aios-cockpit", toolCallId: "aios-cockpit" },
    url,
    { method: "PATCH", body: JSON.stringify(velden), prefer: "return=minimal" },
  );
}
