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

      // Geen eigen check op de status hier: `runSignalTurn` claimt het signaal
      // en geeft `null` terug als de andere route het al heeft. Dat moet daar
      // gebeuren en niet hier, want tussen een check en het werk zit tijd — en
      // precies in dat gat draaide de beurt vandaag twee keer.
      const turn = await runSignalTurn(this.env, signal);
      if (!turn) {
        console.log(`[orchestration] ${signal.id} was al geclaimd — overgeslagen`);
      }
    });
  }
}
