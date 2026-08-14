import { NextResponse } from "next/server";
import {
  cockpitEnv,
  makeClient,
  getReviewItem,
  insertReviewEdit,
} from "@/lib/db";
import { CTX } from "@/lib/db";
import { requireRole } from "@/lib/auth/require-role";

export const dynamic = "force-dynamic";

interface DraftBody {
  subject?: string;
  body?: string;
}

/**
 * POST /api/review/:id/draft — slaat een tussentijdse conceptwijziging op
 * (geen beslissing). Voegt een snapshot toe aan aios_review_edits (audit) én
 * werkt het levende `proposed`-object op het ReviewItem bij, zodat een
 * volgende reviewer de aangepaste tekst ziet.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("reviewer");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;

  let payload: DraftBody;
  try {
    payload = (await request.json()) as DraftBody;
  } catch {
    return new NextResponse("Ongeldige JSON-body", { status: 400 });
  }

  const env = cockpitEnv();
  const client = makeClient(env);
  const existing = await getReviewItem(client, id);
  if (!existing) {
    return new NextResponse("ReviewItem niet gevonden", { status: 404 });
  }
  if (existing.status !== "PENDING") {
    return new NextResponse(
      "ReviewItem is al besloten; bewerken kan niet meer.",
      { status: 409 },
    );
  }

  const prevSubject = existing.proposed?.subject ?? "";
  const prevBody = existing.proposed?.body ?? "";
  const subject = payload.subject ?? prevSubject;
  const body = payload.body ?? prevBody;

  // Niets gewijzigd → geen save / geen edit-rij.
  if (subject === prevSubject && body === prevBody) {
    return NextResponse.json({ ok: true, changed: false });
  }

  // 1. Het levende ReviewItem bijwerken (anders ziet de volgende reviewer
  // nog het oude concept).
  try {
    const url = client.tableUrl("aios_review_items");
    url.searchParams.set("id", `eq.${id}`);
    await client.request<unknown>(CTX, url, {
      method: "PATCH",
      body: JSON.stringify({
        proposed: { ...(existing.proposed ?? {}), subject, body },
      }),
      prefer: "return=minimal",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Opslaan mislukt: ${msg}`, { status: 500 });
  }

  // 2. Audit-snapshot toevoegen.
  try {
    await insertReviewEdit(client, {
      reviewItemId: id,
      editedBy: guard.email,
      subject,
      body,
      source: "manual_save",
    });
  } catch {
    // audit-rij mag niet de save laten falen
  }

  return NextResponse.json({ ok: true, changed: true });
}
