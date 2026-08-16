import { NextResponse } from "next/server";
import { normalizeQuestion } from "@factumai/agent-core";
import { cockpitEnv, makeClient, getReviewItem } from "@/lib/db";
import { requireRole } from "@/lib/auth/require-role";
import { accessFor } from "@/lib/auth/access";
import { moduleForRow } from "@/lib/modules";
import { askAssistant, assistantEnabled } from "@/lib/assistant/run";

export const dynamic = "force-dynamic";

interface AskBody {
  reviewItemId?: unknown;
  question?: unknown;
}

/**
 * Eén vraag aan de werkbak-assistent over één openstaand voorstel.
 *
 * Alleen POST, en alleen lezen: er zit geen route in dit bestand die iets
 * wijzigt. De assistent is een raadpleegvenster — alles wat naar buiten gaat,
 * gaat via de bestaande knoppen.
 *
 * Drie poorten voordat er een model aan te pas komt, in oplopende kosten:
 * vlag, rol, en de modulegrant op het item zelf.
 */
export async function POST(request: Request): Promise<Response> {
  const env = cockpitEnv();
  if (!assistantEnabled(env)) {
    return NextResponse.json({ error: "Assistent staat uit" }, { status: 404 });
  }

  // `viewer` mag meekijken en dus ook vragen stellen over wat hij ziet; de
  // modulegrant hieronder bepaalt waar dat over gaat.
  const guard = await requireRole("viewer");
  if (guard instanceof NextResponse) return guard;

  let payload: AskBody;
  try {
    payload = (await request.json()) as AskBody;
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON-body" }, { status: 400 });
  }

  const question = normalizeQuestion(payload.question);
  if (!question) {
    return NextResponse.json({ error: "Geen vraag meegegeven" }, { status: 400 });
  }
  if (typeof payload.reviewItemId !== "string" || !payload.reviewItemId) {
    return NextResponse.json({ error: "Geen voorstel meegegeven" }, { status: 400 });
  }

  const client = makeClient(env);
  const row = await getReviewItem(client, payload.reviewItemId);
  if (!row) {
    return NextResponse.json({ error: "Voorstel niet gevonden" }, { status: 404 });
  }

  // Zelfde modulegrens als bij beslissen: over een proces waar je niet bij
  // hoort, mag je ook geen vragen stellen. Pas hier te controleren, want
  // vóórdat we het item hebben weten we niet uit welk proces het komt.
  const mod = moduleForRow(row);
  const me = await accessFor(guard);
  if (!mod || !me.access.mayEnter(mod.id)) {
    return NextResponse.json({ error: "Geen rechten op dit proces" }, { status: 403 });
  }

  const { result, sources } = await askAssistant(env, client, mod, row, question);

  // De bronnenlijst gaat altijd mee, ook bij een weigering: dan ziet de
  // medewerker wat de assistent wél had en kan hij zelf kijken.
  const bronnen = sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    href: s.href ?? null,
  }));

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      reason: result.reason,
      message: result.message,
      bronnen,
    });
  }

  return NextResponse.json({
    ok: true,
    answer: result.answer,
    grounding: result.grounding,
    gebruikteBronnen: result.usedSources.map((s) => s.id),
    bronnen,
  });
}
