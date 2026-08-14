import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import {
  cockpitEnv,
  makeClient,
  upsertPolicyRule,
  deletePolicyRule,
} from "@/lib/db";

export const dynamic = "force-dynamic";

const ACTIONS = ["auto_send", "review_queue", "escalate", "no_reply"];

/** PATCH /api/policy/rules/:id (admin) — regel bijwerken. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const env = cockpitEnv();
  if (!env.AIOS_ORG_ID) {
    return NextResponse.json({ error: "org_not_configured" }, { status: 503 });
  }

  const { id: raw } = await params;
  const id = decodeURIComponent(raw);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

  const priority = Number(b.priority);
  try {
    await upsertPolicyRule(makeClient(env), {
      id,
      organizationId: env.AIOS_ORG_ID,
      name,
      description: typeof b.description === "string" ? b.description : null,
      appliesTo: Array.isArray(b.appliesTo) ? (b.appliesTo as string[]) : [],
      responseDirective:
        typeof b.responseDirective === "string" ? b.responseDirective : "",
      priority: Number.isFinite(priority) ? priority : 100,
      enabled: b.enabled !== false,
      action: ACTIONS.includes(b.action as string)
        ? (b.action as string)
        : "review_queue",
      createsTask: b.createsTask === true,
      updatedBy: guard.email,
    });
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}

/** DELETE /api/policy/rules/:id (admin) — regel verwijderen. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  try {
    await deletePolicyRule(makeClient(cockpitEnv()), id);
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
}
