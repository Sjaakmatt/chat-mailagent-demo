import { DurableObject } from 'cloudflare:workers';
import { PgmqSignalConsumer } from '@factumai/agent-core';
import { runPoll, nextPollDelayMs } from '@factumai/agent-core';
import type { Env } from './env.js';

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const DELAY_KEY = 'pollDelayMs';

/**
 * Poller (Build Document A4 — "de seam"). Een Durable Object met alarm leest
 * de pgmq-queue en start per message de Orchestration-Workflow met
 * idempotency-key = msg_id; archiveert pas ná succesvolle start. De
 * Cloudflare Agents SDK `Agent`-klasse kan dit later vervangen; een DO-met-alarm
 * is de concrete poller-driver uit de blueprint.
 *
 * Back-off: bij werk weer snel pollen (MIN_DELAY_MS); bij een lege queue
 * exponentieel oplopen tot MAX_DELAY_MS — te frequent pollen knabbelt aan
 * scale-to-zero.
 */
export class MailPoller extends DurableObject<Env> {
  /** Start de poll-lus (idempotent: zet enkel het alarm als er nog geen is). */
  async start(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) {
      await this.ctx.storage.setAlarm(Date.now() + MIN_DELAY_MS);
    }
  }

  async alarm(): Promise<void> {
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
    const next = nextPollDelayMs(result, current, {
      minMs: MIN_DELAY_MS,
      maxMs: MAX_DELAY_MS,
    });
    await this.ctx.storage.put(DELAY_KEY, next);
    await this.ctx.storage.setAlarm(Date.now() + next);
  }
}
