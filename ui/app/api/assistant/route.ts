import { NextResponse } from "next/server";
import { normalizeHistory, normalizeQuestion } from "@factumai/agent-core";
import { cockpitEnv, makeClient, getReviewItem } from "@/lib/db";
import { requireRole } from "@/lib/auth/require-role";
import { accessFor } from "@/lib/auth/access";
import { moduleById, moduleForRow, MODULES } from "@/lib/modules";
import type { ReviewItemRow } from "@/lib/review";
import { askAssistant, assistantEnabled } from "@/lib/assistant/run";
import { analyseFlagSet } from "@/lib/assistant/analyse";

export const dynamic = "force-dynamic";

interface AskBody {
  /** Het geopende voorstel, als de medewerker er een voor zich heeft. */
  reviewItemId?: unknown;
  /** Waar het gesprek over gaat als er geen voorstel openstaat. */
  moduleId?: unknown;
  question?: unknown;
  /** Eerdere beurten uit hetzelfde gesprek. */
  history?: unknown;
}

/**
 * Eén beurt in het gesprek met de werkbak-assistent.
 *
 * Alleen POST, en alleen lezen: er zit geen route in dit bestand die iets
 * wijzigt. De assistent is een raadpleegvenster — alles wat naar buiten gaat,
 * gaat via de bestaande knoppen.
 *
 * ## Twee gesprekken, één route
 *
 * Mét `reviewItemId` gaat het over dat voorstel: het dossier, de klant, het
 * beslislog. Zónder gaat het over het proces: beleid, werkvoorraad, wat er
 * recent is besloten. De medewerker merkt het verschil niet — hij typt in
 * hetzelfde venster — maar de bronnen zijn een andere set en de rechtencheck
 * hangt aan iets anders: bij een voorstel aan de module van dát item, zonder
 * voorstel aan de module die hij zelf open heeft.
 *
 * Drie poorten voordat er een model aan te pas komt, in oplopende kosten:
 * vlag, rol, en de modulegrant.
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
  const client = makeClient(env);
  const me = await accessFor(guard);

  // Mét voorstel: de module van het item bepaalt of deze medewerker erover mag
  // praten. Zonder voorstel: de module die hij zelf aangeeft, of — als hij er
  // maar één heeft — die ene. Beide keren dezelfde grens als bij beslissen.
  let row: ReviewItemRow | null = null;
  let mod = null;

  if (typeof payload.reviewItemId === "string" && payload.reviewItemId) {
    row = (await getReviewItem(client, payload.reviewItemId)) ?? null;
    if (!row) {
      return NextResponse.json({ error: "Voorstel niet gevonden" }, { status: 404 });
    }
    mod = moduleForRow(row);
  } else {
    const gevraagd =
      typeof payload.moduleId === "string" ? moduleById(payload.moduleId) : null;
    // Geen module meegegeven: de eerste waar deze medewerker in mag. Bij één
    // module — vandaag de regel — is dat gewoon die ene, en hoeft het scherm
    // er niets over te weten.
    mod = gevraagd ?? MODULES.find((m) => me.access.mayEnter(m.id)) ?? null;
    if (mod && !mod.collectGeneralSources) {
      // Fail-closed: een module die geen generieke bronnen levert, heeft geen
      // gesprek buiten een voorstel om. Beter een duidelijk nee dan een
      // assistent die met een lege bronnenlijst gaat praten.
      return NextResponse.json(
        { error: "Deze module heeft geen assistent buiten een voorstel om" },
        { status: 404 },
      );
    }
  }

  if (!mod || !me.access.mayEnter(mod.id)) {
    return NextResponse.json({ error: "Geen rechten op dit proces" }, { status: 403 });
  }

  // Laag 2 alleen als de vlag aanstaat én de vragensteller meer mag zien dan
  // operationeel — anders is er niets te aggregeren wat hij mag zien.
  const analyse =
    analyseFlagSet(env) &&
    me.categories.some((c) => c === "commercieel" || c === "financieel");

  const { result, sources, aggregatie } = await askAssistant(
    env,
    client,
    mod,
    row,
    question,
    {
      analyse,
      categories: me.categories,
      // Uit de browser, dus begrensd en opgeschoond. Dat het niet te
      // vertrouwen is, is hier minder erg dan het klinkt: geschiedenis dekt
      // niets — de controle kijkt alleen naar de bronnen van deze beurt.
      history: normalizeHistory(payload.history),
    },
  );

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
    // Gaat apart mee, niet alleen als bron: de cockpit toont periode,
    // populatie en definitie standaard zichtbaar bij het cijfer.
    aggregatie: aggregatie ?? null,
  });
}
