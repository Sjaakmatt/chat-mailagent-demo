/**
 * AIOS mail-agent — Worker-entrypoint (Build Document Deel C).
 *
 * Exporteert de runtime-bouwstenen die wrangler.jsonc bindt:
 * - MailPoller        — DO-alarm poller (pgmq → Orchestration-Workflow)
 * - OrchestrationWorkflow — classify→resolve→retrieve→plan→ground → ReviewItem
 * - ExecuteWorkflow       — ná approve: idempotente side effect → memory → DONE
 *
 * De fetch-handler is bewust minimaal: publieke inbound hoort op de domein-MCP
 * (verify+normalize+enqueue) en de cockpit-UI, niet hier. Dit endpoint dient
 * alleen om de poller-DO te wekken (achter auth, intern).
 */
import { MailPoller } from './poller-do.js';
import { OrchestrationWorkflow } from './workflows/orchestration.js';
import { ExecuteWorkflow } from './workflows/execute.js';
import { RouterWorkflow } from './workflows/router.js';
import { SpecialistWorkflow } from './workflows/specialist.js';
import { AggregatorWorkflow } from './workflows/aggregator.js';
import type { Env } from './env.js';

export {
  MailPoller,
  OrchestrationWorkflow,
  ExecuteWorkflow,
  RouterWorkflow,
  SpecialistWorkflow,
  AggregatorWorkflow,
};

/**
 * Wekt de singleton poller-DO. Idempotent: `start()` zet alleen een alarm
 * als er nog geen loopt, dus meerdere aanroepen (Cron + handmatig) zijn veilig.
 */
async function kickPoller(env: Env): Promise<void> {
  const id = env.AIOS_POLLER.idFromName('aios-poller');
  const stub = env.AIOS_POLLER.get(id);
  await stub.start();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__poller/start' && request.method === 'POST') {
      await kickPoller(env);
      return new Response('poller gestart', { status: 202 });
    }
    // Staging-only test-endpoint: start de RouterWorkflow direct op een
    // bestaand signalId zonder de pgmq-queue te raken. Prod (met
    // USE_MULTI_AGENT_ROUTER != "true") returned 404. Route:
    //   POST /__test/route/{signalId}
    // Idempotency: instance-id = route-test-{signalId}, dus dubbele call
    // is een no-op tot de instance klaar is.
    if (
      env.USE_MULTI_AGENT_ROUTER === 'true' &&
      request.method === 'POST' &&
      url.pathname.startsWith('/__test/route/')
    ) {
      const signalId = url.pathname.slice('/__test/route/'.length);
      if (!signalId) {
        return new Response('signalId ontbreekt in path', { status: 400 });
      }
      await env.ROUTER.create({
        id: `route-test-${signalId}`,
        params: { signalId },
      });
      return new Response(`RouterWorkflow gestart voor ${signalId}`, {
        status: 202,
      });
    }
    return new Response('AIOS mail-agent. Inbound events horen op de MCP-laag.', {
      status: 404,
    });
  },
  /**
   * Cron-trigger (zie `triggers.crons` in wrangler.jsonc). Doel: safety-net
   * dat de poller-DO in leven houdt na deploys, restarts of edge-cases waar
   * het alarm ooit stopt. De DO regelt intern de back-off (1s–30s) zolang
   * er werk is; de cron is puur een "kick if dead".
   */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await kickPoller(env);
  },
} satisfies ExportedHandler<Env>;
