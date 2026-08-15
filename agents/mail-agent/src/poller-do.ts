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
 * de pgmq-queue en start per message de Orchestration-Workflow op `signalId`;
 * archiveert pas ná succesvolle start.
 *
 * Back-off: bij werk weer snel pollen (MIN_DELAY_MS); bij een lege queue
 * exponentieel oplopen tot MAX_DELAY_MS — te frequent pollen knabbelt aan
 * scale-to-zero.
 *
 * ## Wat hier wél en niet doorheen loopt
 *
 * Mail: alles. Er zit niemand te wachten, dus de wachtrij met back-off is
 * precies goed — hij vangt pieken op en levert at-least-once.
 *
 * Chat: als vangnet. De chat-DO start de lus zelf zodra er een bericht
 * binnenkomt, want daar staat een bezoeker naar een leeg venster te kijken. Dit
 * blijft de tweede route voor het geval die directe start mislukt. Beide
 * gebruiken `signalId` als instance-id, dus wie er ook eerst is, de tweede
 * start doet niets.
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
        // Instance-id op `signalId` en niet op msg_id. Dat is geen detail: de
        // chat-DO start dezelfde lus rechtstreeks zodra er een bericht binnenkomt
        // (zie `chat/session-do.ts`), en die kent alleen het signaal. Delen ze
        // dezelfde sleutel, dan is de tweede start een no-op en kunnen beide
        // routes naast elkaar bestaan — de snelle voor chat, de wachtrij als
        // vangnet. Op msg_id zouden het twee runs op één bericht worden.
        if (useMultiAgent) {
          await this.env.ROUTER.create({
            id: `route-${job.signalId}`,
            params: { signalId: job.signalId },
          });
        } else {
          await this.env.ORCHESTRATION.create({
            id: `orch-${job.signalId}`,
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
