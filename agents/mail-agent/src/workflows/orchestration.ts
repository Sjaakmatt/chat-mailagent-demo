import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { orchestrate, type DecisionLog } from '@factumai/agent-core';
import type { Env, OrchestrationParams } from '../env.js';
import { createPlatformStore } from '../store.js';
import { buildOrchestrationSteps, buildLlmClient, hydrateSignal } from '../steps.js';
import { finishChatTurn } from '../chat/turn.js';

/**
 * Orchestration-Workflow (Build Document A6/C4):
 *   load-signal → orchestrate (gate→classify→resolve→retrieve→plan→ground) → ReviewItem(PENDING)
 *
 * Dit pad heeft GEEN externe side effects (de side effect zit in de Execute-
 * Workflow, ná goedkeuring), dus opnieuw draaien is veilig. We houden het
 * laden + orchestreren + opslaan binnen één durable step die `void` teruggeeft:
 * agent-core werkt met open `Record`-payloads en die kruisen zo geen
 * Workflow-stap-grens (waar Cloudflare strikte serialiseerbaarheid afdwingt).
 * De enige write is het ReviewItem; faalt 'ie, dan hervat de step.
 */
export class OrchestrationWorkflow extends WorkflowEntrypoint<Env, OrchestrationParams> {
  async run(event: WorkflowEvent<OrchestrationParams>, step: WorkflowStep): Promise<void> {
    const store = createPlatformStore(this.env);
    const llm = buildLlmClient(this.env);

    await step.do('orchestrate', async () => {
      const raw = await store.loadSignal(event.payload.signalId);
      // Hydrateer de mail (subject/body/from) — de Signal-payload draagt alleen
      // identifiers; classify/plan hebben de inhoud nodig.
      const signal = await hydrateSignal(this.env, raw);

      const startedAt = Date.now();
      const result = await orchestrate(signal, {
        steps: buildOrchestrationSteps(this.env, llm),
      });
      await store.saveReviewItem(result.reviewItem);

      // Beslislog ná het ReviewItem: het verwijst ernaar, en als het schrijven
      // van het log faalt mag dat de afhandeling niet raken.
      const outOfDomain = result.classification.outOfDomain;
      const log: DecisionLog = {
        signalId: signal.id,
        organizationId: signal.organizationId,
        reviewItemId: result.reviewItem.id,
        channel: signal.domain,
        inDomain: !outOfDomain,
        domainReason: outOfDomain?.reason,
        category: outOfDomain ? null : result.classification.category,
        specialist: outOfDomain ? null : (result.classification.specialist ?? null),
        outcome: result.outcome ?? null,
        // Eén meting om de hele run; per-stap timing vraagt instrumentatie in
        // agent-core en levert nu weinig op.
        steps: [
          {
            step: 'orchestrate',
            ms: Date.now() - startedAt,
            model: this.env.MODEL_PLAN,
            outcome: outOfDomain ? 'gestopt op de domeingrens' : 'ReviewItem aangemaakt',
          },
        ],
        sources: result.sources ?? [],
        ungrounded: result.ungrounded,
        grounding: result.reviewItem.grounding ?? null,
        confidence: result.reviewItem.confidence ?? null,
        createdAt: new Date().toISOString(),
      };
      // Chat is realtime: er zit iemand te wachten, dus de beurt wordt hier
      // afgerond in plaats van in de werkbak. Wát de bezoeker krijgt, hangt af
      // van de uitkomst — zie chat/turn.ts. Bij mail gebeurt dit niet: daar
      // blijft het ReviewItem staan tot een mens 'm goedkeurt.
      if (signal.domain === 'chat') {
        const payload = (signal.payload ?? {}) as { conversationId?: string };
        if (payload.conversationId) {
          try {
            const turn = await finishChatTurn(this.env, result.reviewItem, result.outcome, {
              outOfDomain: Boolean(outOfDomain),
              conversationId: payload.conversationId,
              category: result.classification.category,
            });
            if (turn) {
              log.steps.push({ step: 'chat-turn', outcome: turn.reason });
            }
          } catch (err) {
            // De bezoeker krijgt dan niets terug, maar het ReviewItem staat
            // in de werkbak — een mens kan het alsnog oppakken.
            console.error('[chat] beurt afronden mislukt:', err);
            log.steps.push({ step: 'chat-turn', outcome: 'mislukt — staat in de werkbak' });
          }
        }
      }

      await store.saveDecisionLog(log);
    });
  }
}
