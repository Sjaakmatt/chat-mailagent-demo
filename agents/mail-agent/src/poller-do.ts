import { DurableObject } from 'cloudflare:workers';
import { PgmqSignalConsumer } from '@factumai/agent-core';
import { runPoll, nextPollDelayMs } from '@factumai/agent-core';
import type { Env } from './env.js';

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const DELAY_KEY = 'pollDelayMs';
/** Laatste uitkomst + eventuele fout. Alleen om te kunnen zien wat er is. */
const LAST_KEY = 'lastRun';

/**
 * Poller (Build Document A4 — "de seam"). Een Durable Object met alarm leest
 * de pgmq-queue en start per message de Orchestration-Workflow met
 * idempotency-key = msg_id; archiveert pas ná succesvolle start.
 *
 * Back-off: bij werk weer snel pollen (MIN_DELAY_MS); bij een lege queue
 * exponentieel oplopen tot MAX_DELAY_MS — te frequent pollen knabbelt aan
 * scale-to-zero.
 *
 * ## Waarom hier een try/catch omheen zit
 *
 * De poll-lus houdt zichzelf in leven door aan het eind het volgende alarm te
 * zetten. Gooit het werk daarvóór een fout, dan wordt dat alarm nooit gezet en
 * is de lus **permanent** dood — geen retry, geen log, en aan de buitenkant
 * precies hetzelfde beeld als een chat die het niet doet. Eén hikkende
 * netwerkcall mag geen agent stilleggen, dus het herplannen gebeurt in een
 * `finally` en de fout wordt bewaard in plaats van omhooggegooid.
 *
 * De Cron-trigger blijft het vangnet daaronder, maar is niet langer de enige
 * manier waarop de lus weer op gang komt.
 */
export class MailPoller extends DurableObject<Env> {
  /**
   * Start de poll-lus. Idempotent, en bewust niet "zet alleen een alarm als er
   * geen is": een alarm dat in het verleden ligt is er wél maar gaat nooit
   * meer af. Dat is precies de toestand waarin een poller er levend uitziet en
   * niets doet.
   */
  async start(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing <= Date.now()) {
      await this.ctx.storage.setAlarm(Date.now() + MIN_DELAY_MS);
    }
  }

  /**
   * Er is zojuist werk binnengekomen — poll nu in plaats van bij het volgende
   * alarm. Roept de chat-DO aan direct na het emitten van een Signal.
   *
   * Zonder dit is de wachttijd van een chatbezoeker de back-off van de poller
   * (tot 30 seconden) of, als het alarm stilviel, de Cron (tot 5 minuten). Voor
   * mail is dat prima; voor iemand die in een chatvenster zit te wachten niet.
   */
  async wake(): Promise<void> {
    const soon = Date.now() + 100;
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > soon) {
      await this.ctx.storage.setAlarm(soon);
    }
  }

  /** Wat de poller als laatste deed. Voor `/__poller/status`. */
  async status(): Promise<Record<string, unknown>> {
    return {
      nextAlarm: await this.ctx.storage.getAlarm(),
      delayMs: (await this.ctx.storage.get<number>(DELAY_KEY)) ?? MIN_DELAY_MS,
      last: (await this.ctx.storage.get<Record<string, unknown>>(LAST_KEY)) ?? null,
      now: Date.now(),
    };
  }

  async alarm(): Promise<void> {
    // Standaard-terugval: bij een fout niet meteen weer vol gas, maar ook niet
    // opgeven. De bestaande back-off doet de rest.
    let next = MAX_DELAY_MS;

    try {
      const consumer = PgmqSignalConsumer.fromServiceRole({
        projectUrl: this.env.AIOS_SUPABASE_URL,
        serviceRoleKey: this.env.AIOS_SUPABASE_SERVICE_ROLE_KEY,
      });

      // Fase 2 multi-agent flag: bepaalt welk instap-workflow de poller start.
      // - "true"  → RouterWorkflow → SpecialistWorkflow (2-fase split).
      // - anders  → OrchestrationWorkflow (bestaand 1-fase gedrag).
      // Rollback: env-var op "false" zetten en workers pushen — geen code-wijziging.
      const useMultiAgent = this.env.USE_MULTI_AGENT_ROUTER === 'true';

      const result = await runPoll(consumer, async (job) => {
        // idempotency-key = msg_id → dubbele start is een no-op.
        if (useMultiAgent) {
          await this.env.ROUTER.create({
            id: `route-${job.idempotencyKey}`,
            params: { signalId: job.signalId },
          });
        } else {
          await this.env.ORCHESTRATION.create({
            id: `orch-${job.idempotencyKey}`,
            params: { signalId: job.signalId },
          });
        }
      });

      const current = (await this.ctx.storage.get<number>(DELAY_KEY)) ?? MIN_DELAY_MS;
      next = nextPollDelayMs(result, current, {
        minMs: MIN_DELAY_MS,
        maxMs: MAX_DELAY_MS,
      });
      await this.ctx.storage.put(LAST_KEY, { at: Date.now(), ...result, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Luid loggen: dit is de fout die anders alleen zichtbaar is als "de chat
      // doet niets". `wrangler tail` laat 'm nu meteen zien.
      console.error(`[poller] poll mislukt: ${message}`);
      await this.ctx.storage.put(LAST_KEY, { at: Date.now(), error: message });
    } finally {
      // Altijd. Dit is de regel die de lus in leven houdt.
      await this.ctx.storage.put(DELAY_KEY, next);
      await this.ctx.storage.setAlarm(Date.now() + next);
    }
  }
}
