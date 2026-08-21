import { NextRequest, NextResponse } from "next/server";
import { KLANTENSERVICE_MODULE } from "@factumai/agent-core/modules/klantenservice";
import { cockpitEnv, makeClient } from "@/lib/db";
import { requireModule } from "@/lib/auth/access";
import { labelFeedback, EVAL_LABELS, type EvalLabel, type TriageStatus } from "@/lib/visitor-feedback";

export const dynamic = "force-dynamic";

const STATUSSEN: TriageStatus[] = ["NEW", "LABELED", "DISMISSED"];
const LABELS = EVAL_LABELS.map((l) => l.key);

/**
 * PATCH /api/feedback/:id — een medewerker beoordeelt bezoekersfeedback.
 *
 * De bezoeker geeft een duim; hier bepaalt een mens wát er misging. Dat
 * onderscheid is de kern van de opzet: de duim is het signaal, het label is het
 * oordeel, en alleen het oordeel wordt een testcase.
 *
 * Reviewer+ mag labelen; viewers kijken mee. De validatie staat hier en niet in
 * de UI — een knop verbergen is geen beveiliging.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Rol én module: bezoekersfeedback gaat over antwoorden van klantenservice,
  // en labelen stuurt de eval-set. Dat is geen werk voor een andere afdeling.
  const guard = await requireModule(KLANTENSERVICE_MODULE.id, "reviewer");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  let body: { status?: unknown; label?: unknown; expected?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ongeldige body" }, { status: 400 });
  }

  const { status, label, expected } = body;

  if (typeof status !== "string" || !STATUSSEN.includes(status as TriageStatus)) {
    return NextResponse.json(
      { error: `status moet een van ${STATUSSEN.join(", ")} zijn` },
      { status: 400 },
    );
  }
  if (label != null && (typeof label !== "string" || !LABELS.includes(label as EvalLabel))) {
    return NextResponse.json(
      { error: `label moet een van ${LABELS.join(", ")} zijn` },
      { status: 400 },
    );
  }
  // Zonder verwachting is er niets te asserten: dan is het geen testcase maar
  // een lege doos. Bij `routing` moet het bovendien een bestaande categorie
  // zijn — een typefout levert een test op die nooit kan slagen.
  if ((label === "other" || label === "routing") &&
      (typeof expected !== "string" || !expected.trim())) {
    return NextResponse.json(
      { error: `Bij label "${label}" is een verwachting verplicht` },
      { status: 400 },
    );
  }
  // De categorieën van déze module: feedback op een routing hoort te
  // verwijzen naar een categorie waarin dit proces ook echt classificeert.
  const slugs = KLANTENSERVICE_MODULE.categories.map((c) => c.slug);
  if (label === "routing" && !slugs.includes(expected as string)) {
    return NextResponse.json(
      { error: `"${expected}" is geen bestaande categorie` },
      { status: 400 },
    );
  }

  try {
    await labelFeedback(
      makeClient(cockpitEnv()),
      id,
      {
        status: status as TriageStatus,
        label: (label as EvalLabel) ?? null,
        expected: typeof expected === "string" ? expected : null,
      },
      guard.email,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Bijwerken mislukt: ${msg}` }, { status: 500 });
  }
}
