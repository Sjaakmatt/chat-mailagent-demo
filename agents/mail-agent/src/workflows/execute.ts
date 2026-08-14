import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { executeApproved } from '@factumai/agent-core';
import type { Env, ExecuteParams } from '../env.js';
import { createPlatformStore } from '../store.js';
import { performReviewItemAction } from '../channels.js';
import { runAfterExecuteHooks } from '../domain/index.js';

/**
 * Execute-Workflow (Build Document A6/C4): draait ná menselijke goedkeuring,
 * idempotent. Een APPROVED/EDITED ReviewItem → side effect via internal-mcp-mail
 * → MemoryEntry → EXECUTED → Signal = DONE.
 *
 * De idempotency-key (= pgmq msg_id van de execute-message) zorgt dat een
 * dubbele run de side effect niet herhaalt (agent-core `executeApproved`).
 * Eén durable step (void) houdt de open `Record`-payloads binnen de step i.p.v.
 * over de stap-grens (Cloudflare dwingt daar strikte serialiseerbaarheid af).
 *
 * Klant-specifieke vervolgacties horen niet hier maar in een domeinmodule —
 * zie `../domain/index.ts`.
 */
export class ExecuteWorkflow extends WorkflowEntrypoint<Env, ExecuteParams> {
  async run(event: WorkflowEvent<ExecuteParams>, step: WorkflowStep): Promise<void> {
    const store = createPlatformStore(this.env);

    await step.do('execute', async () => {
      const item = await store.loadReviewItem(event.payload.reviewItemId);

      const result = await executeApproved(item, event.payload.idempotencyKey, {
        performAction: (ri) => performReviewItemAction(this.env, ri),
      });

      if (result.memoryEntry) {
        // TODO(discovery): upsert MemoryEntry (pgvector) — agent leert van wat hij deed.
      }
      // ReviewItem → EXECUTED (idempotent upsert) en Signal → DONE, zodat de
      // cockpit de afronding toont en het signaal niet als open blijft staan.
      const executed: typeof item = {
        ...item,
        status: 'EXECUTED',
        executedAt: new Date().toISOString(),
      };
      await store.saveReviewItem(executed);
      if (item.signalId) {
        await store.markSignal(item.signalId, 'DONE');
      }

      // Klant-specifieke vervolgacties (fail-soft: een kapotte domeinmodule mag
      // een succesvol verstuurde mail nooit alsnog laten falen).
      const hookErrors = await runAfterExecuteHooks({ env: this.env, item: executed });
      for (const err of hookErrors) {
        console.error('[execute] domain hook failed', item.id, err.message);
      }
    });
  }
}
