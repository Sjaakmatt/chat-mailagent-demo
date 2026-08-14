import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { cockpitEnv, makeClient, promotePolicyRule } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/policy/rules/:id/promote (admin) — kopieer deze policy-rule van
 * de huidige tenant (child) naar de parent-org. Alleen beschikbaar als:
 *   - COCKPIT_MODE === "staging" (voorkomt "promote" op prod-cockpit)
 *   - AIOS_PARENT_ORG_ID is gezet (weet naar wie te promoten)
 *
 * Fase 5C — sluit de ET/PR-loop: reviewer test op staging, klikt "Push naar
 * prod", en de rule verschijnt (of wordt overschreven) op de klant-org.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const env = cockpitEnv();
  if (env.COCKPIT_MODE !== "staging") {
    return NextResponse.json(
      { error: "only_available_on_staging" },
      { status: 403 },
    );
  }
  if (!env.AIOS_PARENT_ORG_ID) {
    return NextResponse.json(
      { error: "parent_org_not_configured" },
      { status: 503 },
    );
  }

  const { id: raw } = await params;
  const id = decodeURIComponent(raw);

  try {
    const result = await promotePolicyRule(makeClient(env), {
      childRuleId: id,
      parentOrgId: env.AIOS_PARENT_ORG_ID,
      promotedBy: guard.email,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "niet gevonden" duidt op een 404, andere fouten op een 500.
    if (msg.includes("niet gevonden")) {
      return NextResponse.json({ error: "child_rule_not_found" }, { status: 404 });
    }
    console.error("[promote] policy-rule promote faalde:", err);
    return NextResponse.json({ error: "promote_failed" }, { status: 500 });
  }
}
