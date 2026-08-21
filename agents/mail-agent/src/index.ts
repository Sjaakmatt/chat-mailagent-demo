/**
 * AIOS mail-agent — Worker-entrypoint (Build Document Deel C).
 *
 * Exporteert de runtime-bouwstenen die wrangler.jsonc bindt:
 * - MailPoller        — DO-alarm poller (pgmq → Orchestration-Workflow)
 * - OrchestrationWorkflow — classify→resolve→retrieve→plan→ground → ReviewItem
 * - ExecuteWorkflow       — ná approve: idempotente side effect → memory → DONE
 * - ActionExecuteWorkflow — ná approve van een schrijfoperatie: hervalideren → schrijven
 *
 * De fetch-handler is smal gehouden. Eén publiek pad: `POST /hooks/:bron`, voor
 * bronnen waarvoor geen domein-MCP bestaat — die verifieert en emit, en verder
 * niets. Heeft een bron wél een MCP, dan hoort de inbound daar (verify +
 * normalize + enqueue). De rest van de routes is intern of demo.
 */
import { MailPoller } from './poller-do.js';
import { OrchestrationWorkflow } from './workflows/orchestration.js';
import { ExecuteWorkflow } from './workflows/execute.js';
import { ActionExecuteWorkflow } from './workflows/action-execute.js';
import { RouterWorkflow } from './workflows/router.js';
import { SpecialistWorkflow } from './workflows/specialist.js';
import { AggregatorWorkflow } from './workflows/aggregator.js';
import { ChatSession } from './chat/session-do.js';
import { chatWidgetResponse } from './chat/widget.js';
import { widgetLoaderResponse, widgetFrameResponse } from './chat/embed.js';
import { verifyChatIdentity, customerSessionId } from '@factumai/agent-core';
import { handleWebhook } from './intake/webhook.js';
import { runAutomations } from './intake/schedule.js';
import { runPolls } from './intake/poll.js';
import { handleUpload } from './intake/upload.js';
import type { Env } from './env.js';

export {
  MailPoller,
  ChatSession,
  OrchestrationWorkflow,
  ExecuteWorkflow,
  ActionExecuteWorkflow,
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

    // Externe gebeurtenissen. Bovenaan omdat dit het enige publieke,
    // ondertekende pad naar de bus is; alles eronder is intern of demo.
    const hook = await handleWebhook(request, env, url);
    if (hook) return hook;

    // Een geüpload document. Zelfde deur, zelfde handtekening: hier komt een
    // verwijzing naar een bestand in Storage binnen, geen bestand.
    const upload = await handleUpload(request, env, url);
    if (upload) return upload;

    if (url.pathname === '/__poller/start' && request.method === 'POST') {
      await kickPoller(env);
      return new Response('poller gestart', { status: 202 });
    }
    // Waarom dit endpoint bestaat: een stilgevallen poller ziet er aan de
    // buitenkant uit als een chat die niet werkt. Zonder dit is de enige route
    // naar het antwoord `wrangler tail` op het juiste moment. Nu is het één URL:
    // staat er een alarm, wanneer draaide hij, en wat ging er mis.
    if (url.pathname === '/__poller/status' && request.method === 'GET') {
      const id = env.AIOS_POLLER.idFromName('aios-poller');
      const status = await env.AIOS_POLLER.get(id).status();
      return Response.json(status);
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
    // Testwidget: één pagina om de hele chat-keten in een browser te lopen.
    // Alleen als DEMO_MODE aan staat — dit hoort niet op een productie-Worker.
    if (url.pathname === '/chat' && request.method === 'GET') {
      if (env.DEMO_MODE !== 'true') {
        return new Response('Testwidget staat uit (zet DEMO_MODE=true).', { status: 404 });
      }
      return chatWidgetResponse();
    }

    // Productiewidget. Bewust NIET achter DEMO_MODE: dit is wat op de site van
    // een klant komt te staan. Wie 'm mag insluiten regelt `frame-ancestors`
    // op het iframe-antwoord, niet een vlag.
    if (url.pathname === '/widget.js' && request.method === 'GET') {
      return widgetLoaderResponse();
    }
    if (url.pathname === '/widget' && request.method === 'GET') {
      return widgetFrameResponse(env);
    }

    // Chat: de bezoeker verbindt met /chat/<sessie>/ws. Elke sessie is een
    // eigen Durable Object, zodat snel achter elkaar getypte berichten niet
    // op elkaars gespreksstand botsen.
    if (url.pathname.startsWith('/chat/')) {
      const rest = url.pathname.slice('/chat/'.length);
      const sessionId = rest.split('/')[0];
      if (!sessionId) {
        return new Response('sessie-id ontbreekt in path', { status: 400 });
      }

      // Is deze bezoeker een ingelogde klant van de winkel? Dan hangt zijn
      // gesprek aan zijn klant-id in plaats van aan een willekeurig id uit de
      // browser, en vindt hij het morgen op een ander apparaat terug.
      //
      // De verificatie hoort HIER en niet alleen bij het renderen van de widget:
      // het pad bepaalt welk Durable Object je krijgt, dus wie een sessienaam
      // raadt, zou anders bij dat gesprek kunnen. Klopt de handtekening niet,
      // dan valt de bezoeker terug op de anonieme sessie uit het pad — geen
      // foutmelding, wel een logregel.
      const identity = await verifyChatIdentity(
        { customerId: url.searchParams.get('uid'), hash: url.searchParams.get('uhash') },
        env.CHAT_IDENTITY_SECRET,
      );
      if (identity.reason !== 'anoniem' && !identity.verified) {
        console.warn(`[chat] identiteitsclaim afgewezen: ${identity.reason}`);
      }
      const naam =
        identity.verified && identity.customerId && env.CHAT_IDENTITY_SECRET
          ? await customerSessionId(identity.customerId, env.CHAT_IDENTITY_SECRET)
          : sessionId;

      const id = env.CHAT_SESSION.idFromName(naam);
      return env.CHAT_SESSION.get(id).fetch(request);
    }

    return new Response('AIOS mail-agent. Inbound events horen op de MCP-laag.', {
      status: 404,
    });
  },
  /**
   * Cron-trigger (zie `triggers.crons` in wrangler.jsonc). Drie taken:
   *
   * 1. **De poller wakker houden.** Safety-net na deploys, restarts en
   *    edge-cases waar het alarm ooit stopt. De DO regelt intern de back-off
   *    (1s–30s) zolang er werk is; dit is puur een "kick if dead".
   * 2. **De geplande automatiseringen draaien.** Dit is de ingang waarlangs een
   *    domein begint zonder dat er iemand mailt.
   * 3. **De bronnen bevragen die zelf niets sturen.** Voor systemen zonder
   *    webhook is periodiek zelf kijken de enige ingang.
   *
   * De drie staan los van elkaar en dat is met opzet: valt het uitlezen van de
   * automatiseringen om, dan blijft de poller alsnog leven. Andersom net zo.
   * `allSettled` en geen `all`: één afgebroken taak mag de andere twee niet
   * meenemen.
   */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const uitkomsten = await Promise.allSettled([
      kickPoller(env),
      runAutomations(env),
      runPolls(env),
    ]);
    for (const uitkomst of uitkomsten) {
      if (uitkomst.status === 'rejected') {
        console.error('[cron] taak faalde:', uitkomst.reason);
      }
    }
  },
} satisfies ExportedHandler<Env>;
