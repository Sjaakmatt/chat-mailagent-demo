import { NextResponse } from "next/server";
import {
  cockpitEnv,
  makeClient,
  getReviewItem,
  decideReviewItem,
  insertReviewEdit,
} from "@/lib/db";
import { writeFeedback } from "@/lib/feedback";
import type { CockpitEnv } from "@/lib/env";
import { requireRole } from "@/lib/auth/require-role";
import { accessFor } from "@/lib/auth/access";
import { moduleForRow } from "@/lib/modules";

export const dynamic = "force-dynamic";

interface DecisionBody {
  action: "approve" | "edit" | "reject";
  subject?: string;
  body?: string;
  reason?: string;
}

/** Start de Execute-Workflow; een bestaande instance (dubbele approve) = no-op. */
async function startExecute(env: CockpitEnv, reviewItemId: string): Promise<void> {
  try {
    await env.EXECUTE.create({
      id: `exec-${reviewItemId}`,
      params: { reviewItemId, idempotencyKey: reviewItemId },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already exists|instance.*exists/i.test(msg)) throw err;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("reviewer");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  let payload: DecisionBody;
  try {
    payload = (await request.json()) as DecisionBody;
  } catch {
    return new NextResponse("Ongeldige JSON-body", { status: 400 });
  }

  const action = payload.action;
  if (action !== "approve" && action !== "edit" && action !== "reject") {
    return new NextResponse("Onbekende actie", { status: 400 });
  }

  const env = cockpitEnv();
  const client = makeClient(env);

  const existing = await getReviewItem(client, id);
  if (!existing) {
    return new NextResponse("ReviewItem niet gevonden", { status: 404 });
  }
  if (existing.status !== "PENDING") {
    return new NextResponse("ReviewItem is al besloten", { status: 409 });
  }

  // Rang is niet genoeg: een reviewer in klantenservice hoort een
  // administratie-item niet goed te keuren. De modulegrant beslist dat, en
  // pas hier — want vóór het ophalen weten we niet uit welk proces dit komt.
  const mod = moduleForRow(existing);
  const me = await accessFor(guard);
  if (!mod || !me.access.mayEnter(mod.id)) {
    return new NextResponse("Geen rechten op dit proces", { status: 403 });
  }

  // Wat er in de feedbacklus als "het oorspronkelijke concept" telt. Nog een
  // mailveld, en dat blijft zo tot de feedbacklaag zelf module-agnostisch is;
  // het staat in OPEN-PUNTEN.md.
  const bestaand = (existing.proposed ?? {}) as Record<string, unknown>;
  const originalDraft = typeof bestaand.body === "string" ? bestaand.body : "";

  try {
    if (action === "reject") {
      await decideReviewItem(client, id, "REJECTED", undefined, guard.email);
      await writeFeedback(env, existing, "REJECTED", {
        originalDraft,
        reason: payload.reason ?? "",
      });
      return NextResponse.json({ ok: true, status: "REJECTED" });
    }

    if (action === "edit") {
      // De module bepaalt hoe een bewerking terug in `proposed` landt. Deze
      // route schreef `subject` en `body` — mailvelden — en zou een offerte met
      // gewijzigde regels mangelen tot een mail met een onderwerp.
      const proposed = mod.applyEdit(existing, {
        ...(payload.subject !== undefined ? { subject: payload.subject } : {}),
        ...(payload.body !== undefined ? { body: payload.body } : {}),
      });
      const editedBody =
        typeof proposed.body === "string" ? proposed.body : originalDraft;
      const finalSubject = typeof proposed.subject === "string" ? proposed.subject : "";
      await decideReviewItem(client, id, "EDITED", proposed, guard.email);
      // Audit: snapshot van de finale wijziging bij de beslissing.
      try {
        await insertReviewEdit(client, {
          reviewItemId: id,
          editedBy: guard.email,
          subject: finalSubject,
          body: editedBody,
          source: "decision",
        });
      } catch {
        // edit-historie mag nooit de beslissing tegenhouden
      }
      await startExecute(env, id);
      await writeFeedback(env, existing, "EDITED", {
        finalBody: editedBody,
        originalDraft,
      });
      return NextResponse.json({ ok: true, status: "EDITED" });
    }

    // approve
    await decideReviewItem(client, id, "APPROVED", undefined, guard.email);
    await startExecute(env, id);
    await writeFeedback(env, existing, "APPROVED", { finalBody: originalDraft });
    return NextResponse.json({ ok: true, status: "APPROVED" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Beslissing mislukt: ${msg}`, { status: 500 });
  }
}
