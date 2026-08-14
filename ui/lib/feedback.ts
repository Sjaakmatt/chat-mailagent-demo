import {
  SupabaseClient,
  ServiceRoleCredentialStore,
  createVoyageEmbeddingClient,
  insertMemoryEntry,
  type TenantContext,
} from "@factumai/agent-core";
import { buildFeedbackMemory, type FeedbackDecision } from "@factumai/agent-core";
import type { CockpitEnv } from "./env";
import type { ReviewItemRow } from "./review";

/**
 * Schrijft een feedback-MemoryEntry (few-shot referentie) bij een beslissing —
 * alleen als RAG voor de tenant aanstaat. GOOD = nastreven, BAD = vermijden.
 * Best-effort: een fout hier mag de beslissing nooit blokkeren.
 */
export async function writeFeedback(
  env: CockpitEnv,
  row: ReviewItemRow,
  decision: FeedbackDecision,
  opts: { finalBody?: string; originalDraft?: string; reason?: string },
): Promise<void> {
  const ragEnabled =
    env.AIOS_RAG_ENABLED === "true" && Boolean(env.VOYAGE_API_KEY);
  if (!ragEnabled) return;

  const draft = buildFeedbackMemory({
    reviewItem: {
      id: row.id,
      organizationId: row.organization_id,
      summary: row.summary,
    },
    decision,
    finalBody: opts.finalBody,
    originalDraft: opts.originalDraft,
    reason: opts.reason,
  });
  if (!draft) return;

  try {
    const emb = await createVoyageEmbeddingClient({
      apiKey: env.VOYAGE_API_KEY as string,
      model: env.MODEL_EMBED,
    }).embed(draft.body);

    const db = new SupabaseClient(
      new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
      { projectUrl: env.AIOS_SUPABASE_URL },
    );
    const ctx: TenantContext = {
      organizationId: row.organization_id,
      agentId: "aios-cockpit",
      toolCallId: "aios-cockpit",
    };

    await insertMemoryEntry(db, ctx, {
      organizationId: draft.organizationId,
      scope: draft.scope,
      pinned: draft.pinned,
      title: draft.title,
      body: draft.body,
      embedding: emb,
      source: draft.source,
      sourceRef: draft.sourceRef,
      label: draft.label,
      supersededDraft: draft.supersededDraft,
    });
  } catch (err) {
    console.error("[cockpit] feedback-memory schrijven mislukt:", err);
  }
}
