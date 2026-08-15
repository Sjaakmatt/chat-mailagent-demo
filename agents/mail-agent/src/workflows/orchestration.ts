import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env, OrchestrationParams } from '../env.js';
import { createPlatformStore } from '../store.js';
import { runSignalTurn } from '../turn-runner.js';

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
 *
 * De beurt zelf staat in `turn-runner.ts`, want de chat-DO draait 'm
 * rechtstreeks — zonder Workflow ertussen, omdat daar iemand op het antwoord
 * wacht. Deze Workflow is het duurzame pad: alles voor mail, en het vangnet
 * voor chat als die directe start mislukt.
 */
export class OrchestrationWorkflow extends WorkflowEntrypoint<Env, OrchestrationParams> {
  async run(event: WorkflowEvent<OrchestrationParams>, step: WorkflowStep): Promise<void> {
    const store = createPlatformStore(this.env);

    await step.do('orchestrate', async () => {
      const signal = await store.loadSignal(event.payload.signalId);

      // Al afgehandeld — vrijwel altijd doordat de chat-DO deze beurt zelf heeft
      // gedraaid en de wachtrij hier achteraan komt. Opnieuw draaien zou de
      // bezoeker een tweede antwoord sturen en een tweede ReviewItem opleveren.
      if (signal.status === 'DONE' || signal.processedAt) {
        console.log(`[orchestration] ${signal.id} was al afgehandeld — overgeslagen`);
        return;
      }

      await runSignalTurn(this.env, signal);
    });
  }
}
