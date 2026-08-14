/**
 * Execute-pijplijn (Build Document A6/C4): draait ná menselijke goedkeuring,
 * idempotent. Een goedgekeurd ReviewItem → side effect via een domein-MCP →
 * MemoryEntry (indien RAG) → status EXECUTED.
 *
 * Idempotentie is cruciaal: de Execute-Workflow krijgt een idempotency-key
 * (= pgmq msg_id van de execute-message). Een dubbele run mag de side effect
 * niet herhalen — daarom checkt `isAlreadyExecuted` eerst.
 */

import type { MemoryEntry, ReviewItem } from '../contracts/index.js';

export interface PerformActionResult {
  /** Externe referentie van de uitgevoerde actie (bv. verzonden message-id). */
  ref?: string;
}

export interface ExecuteDeps {
  /** Voert de daadwerkelijke side effect uit via een domein-MCP. */
  performAction(item: ReviewItem): Promise<PerformActionResult>;
  /** Idempotentie-guard: is deze key al uitgevoerd? Dubbele run ⇒ no-op. */
  isAlreadyExecuted?(idempotencyKey: string): Promise<boolean>;
  /** Schrijf een MemoryEntry terug (agent leert van wat hij deed). Default true. */
  writeMemory?: boolean;
  now?: () => string;
  newId?: () => string;
}

export interface ExecuteResult {
  reviewItem: ReviewItem;
  memoryEntry?: MemoryEntry;
  /** True wanneer de run een idempotente no-op was (al uitgevoerd). */
  skipped: boolean;
}

function defaultId(): string {
  return `mem_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Voert een goedgekeurd ReviewItem uit. Vereist status APPROVED of EDITED —
 * uitvoeren van iets dat niet (meer) goedgekeurd is, is een bug en gooit.
 */
export async function executeApproved(
  item: ReviewItem,
  idempotencyKey: string,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  if (item.status !== 'APPROVED' && item.status !== 'EDITED') {
    throw new Error(
      `executeApproved vereist een APPROVED/EDITED ReviewItem, kreeg ${item.status}`,
    );
  }

  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? defaultId;

  if (deps.isAlreadyExecuted && (await deps.isAlreadyExecuted(idempotencyKey))) {
    return {
      reviewItem: { ...item, status: 'EXECUTED' },
      skipped: true,
    };
  }

  const { ref } = await deps.performAction(item);

  const executedAt = now();
  const reviewItem: ReviewItem = {
    ...item,
    status: 'EXECUTED',
    executedAt,
  };

  let memoryEntry: MemoryEntry | undefined;
  if (deps.writeMemory !== false) {
    memoryEntry = {
      id: newId(),
      organizationId: item.organizationId,
      scope: 'CLIENT',
      pinned: false,
      title: item.summary,
      body: typeof item.proposed.body === 'string' ? item.proposed.body : item.summary,
      source: `reviewitem:${item.id}`,
      sourceRef: ref ?? null,
      createdAt: executedAt,
    };
  }

  return { reviewItem, memoryEntry, skipped: false };
}
