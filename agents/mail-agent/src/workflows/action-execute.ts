import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { evaluateApproval } from '@factumai/agent-core';
import type { ActionExecuteParams, Env } from '../env.js';
import { createPlatformStore } from '../store.js';
import { executeAction, readCurrentState } from '../actions/execute.js';

/**
 * Goedkeuren en uitvoeren van één schrijfoperatie.
 *
 * ## Waarom het goedkeuren hier gebeurt en niet in de API-route
 *
 * Harde regel 3 zegt: side effects in een idempotente Workflow. Maar er is een
 * tweede reden die zwaarder weegt, en die gaat over wáár de waarheid vandaan
 * komt.
 *
 * `evaluateApproval` toetst vijf dingen tegelijk — bestaat het type, is het
 * voorstel nog open, is het niet verlopen, heeft de goedkeurder de rang, en
 * klopt de preconditie nog tegen de actuele systeemstaat. Dat laatste vereist
 * een lookup in het bronsysteem, en die lookup leeft hier (`PRECONDITION_READERS`),
 * niet in de cockpit. Zou de route alvast op `goedgekeurd` zetten en hier alleen
 * nog de drift toetsen, dan is die ene functie opgeknipt over twee plekken — en
 * dan is er een plek die een controle vergeet.
 *
 * Daarom blijft het voorstel op `voorgesteld` tot deze Workflow draait. De route
 * doet wat ze wél weet: is er een sessie, heeft die persoon de rang, en bestaat
 * het voorstel. Wie er heeft goedgekeurd komt als parameter mee, want hier is
 * geen ingelogde gebruiker meer.
 *
 * ## Idempotentie
 *
 * De instance-id is afgeleid van het actie-id, dus een tweede klik levert geen
 * tweede run op. Komt hij er tóch (herstart na een storing), dan stopt de run
 * op `uitgevoerd` en gaat de idempotentiesleutel mee naar het doelsysteem.
 */
export class ActionExecuteWorkflow extends WorkflowEntrypoint<Env, ActionExecuteParams> {
  async run(event: WorkflowEvent<ActionExecuteParams>, step: WorkflowStep): Promise<void> {
    const store = createPlatformStore(this.env);
    const { actionId, approverRole, approvedBy } = event.payload;

    // Eén durable step: de payloads zijn open `Record`s en die kruisen geen
    // stap-grens (Cloudflare dwingt daar strikte serialiseerbaarheid af).
    await step.do('goedkeuren-en-uitvoeren', async () => {
      const action = await store.loadProposedAction(actionId);
      if (!action) {
        console.warn(`[actie] ${actionId} bestaat niet (meer) — niets gedaan`);
        return;
      }

      // Al uitgevoerd: dit is een herhaalde run, geen tweede opdracht. Stil
      // stoppen, want de sleutel heeft z'n werk gedaan.
      if (action.status === 'uitgevoerd') return;

      let actueel: Record<string, unknown>;
      try {
        actueel = await readCurrentState({ env: this.env, action });
      } catch (err) {
        // Niet kunnen controleren is geen reden om het maar te doen. Terug naar
        // de wachtrij met de reden, zodat een mens ziet wát er mis is.
        await store.markProposedAction(
          actionId,
          'mislukt',
          err instanceof Error ? err.message : String(err),
          approvedBy,
        );
        return;
      }

      const oordeel = evaluateApproval({
        action,
        actueel,
        approverRole,
        now: new Date(),
      });

      if (!oordeel.ok) {
        // Verlopen of afgewezen. De reden bevat welk veld is opgeschoven en van
        // wat naar wat — dat is wat een mens nodig heeft om te beslissen of er
        // een nieuw voorstel moet komen. "Verlopen" alleen zegt hem niets.
        await store.markProposedAction(actionId, oordeel.status, oordeel.reason, approvedBy);
        return;
      }

      // Vastleggen dát het is goedgekeurd, vóór de schrijfactie. Valt de Worker
      // hierna om, dan staat er in elk geval wie er ja heeft gezegd — en niet
      // een voorstel dat er nog onbesloten uitziet terwijl er misschien al iets
      // is weggeschreven.
      await store.markProposedAction(actionId, 'goedgekeurd', null, approvedBy);

      try {
        const { ref } = await executeAction({ env: this.env, action });
        await store.markProposedAction(actionId, 'uitgevoerd', ref ?? null, approvedBy);
      } catch (err) {
        // `mislukt` en niet `afgewezen`: een netwerkfout halverwege mag opnieuw,
        // en de idempotentiesleutel voorkomt dat dat dubbel schrijft. Een
        // voorstel definitief weggooien om een tijdelijke storing is erger.
        const reden = err instanceof Error ? err.message : String(err);
        console.error(`[actie] ${actionId} uitvoeren mislukt:`, reden);
        await store.markProposedAction(actionId, 'mislukt', reden, approvedBy);
      }
    });
  }
}
