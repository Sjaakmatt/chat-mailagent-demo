import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { orchestrate } from '@factumai/agent-core';
import type { Env, OrchestrationParams } from '../env.js';
import { createPlatformStore } from '../store.js';
import { buildOrchestrationSteps, buildLlmClient, hydrateSignal } from '../steps.js';

/**
 * Orchestration-Workflow (Build Document A6/C4):
 *   load-signal → orchestrate (classify→resolve→retrieve→plan→ground) → ReviewItem(PENDING)
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
      const { reviewItem } = await orchestrate(signal, {
        steps: buildOrchestrationSteps(this.env, llm),
      });
      await store.saveReviewItem(reviewItem);
    });
  }
}
