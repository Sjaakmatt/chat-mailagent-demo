import {
  orchestrate,
  type DecisionLog,
  type ProgressPhase,
  type Signal,
} from '@factumai/agent-core';
import type { Env } from './env.js';
import { createPlatformStore } from './store.js';
import { buildOrchestrationSteps, buildLlmClient, hydrateSignal } from './steps.js';
import { finishChatTurn } from './chat/turn.js';

/**
 * Eén beurt: van signaal tot ReviewItem, en bij chat tot een antwoord op de
 * socket.
 *
 * ## Waarom dit hier staat en niet in de Workflow
 *
 * Er zijn twee aanroepers met tegengestelde eisen:
 *
 *   mail  duurzaamheid boven snelheid. Er zit niemand te wachten; een run mag
 *         hervat worden en een uur later alsnog slagen. Draait via de
 *         Orchestration-Workflow.
 *   chat  snelheid boven duurzaamheid. Er staat iemand naar een leeg venster te
 *         kijken. Draait rechtstreeks in de chat-DO, zonder Workflow ertussen.
 *
 * Zou dit in de Workflow blijven staan, dan zou de chat een Workflow-instantie
 * moeten laten aanmaken en plannen vóór de eerste LLM-call begint. Dat is
 * seconden die de bezoeker als traagheid ervaart, voor een garantie die hij
 * niet nodig heeft: mislukt zijn beurt, dan staat het signaal nog op de bus en
 * pakt de poller 'm alsnog op.
 *
 * De lus zelf is identiek — dat is precies waarom `orchestrate()` in
 * agent-core runtime-agnostisch is. Eén implementatie, twee aanroepers, geen
 * kans dat chat en mail uit elkaar gaan lopen.
 *
 * ## Precies één keer, ook met twee routes
 *
 * De chat-DO draait dit inline én het signaal staat op de wachtrij. Zonder
 * bescherming zou de poller de beurt een tweede keer draaien en de bezoeker een
 * tweede antwoord sturen. Daarom zet deze functie na afloop `status = DONE`, en
 * slaat de Workflow een signaal over dat al verwerkt is.
 */
export interface TurnResult {
  reviewItemId: string;
  /** Wat de bezoeker terugkreeg, als dit een chatbeurt was. */
  reply?: string;
}

export interface TurnOptions {
  /**
   * Faseovergangen, voor kanalen waar iemand zit te wachten. De chat-DO
   * vertaalt ze naar een regel in het venster; bij mail laat je 'm weg.
   */
  onProgress?: (phase: ProgressPhase) => void;
}

export async function runSignalTurn(
  env: Env,
  input: Signal,
  opts: TurnOptions = {},
): Promise<TurnResult> {
  const store = createPlatformStore(env);
  const llm = buildLlmClient(env);

  // Bij mail haalt dit onderwerp en tekst op uit de mailbox; bij chat zit de
  // inhoud al in de payload en komt het signaal ongewijzigd terug.
  const signal = await hydrateSignal(env, input);

  const startedAt = Date.now();
  const result = await orchestrate(signal, {
    steps: buildOrchestrationSteps(env, llm),
    onProgress: opts.onProgress,
  });

  // Dit blijft vóór het antwoord staan, en dat is geen slordigheid: bij uitkomst
  // `taak` maakt `finishChatTurn` een ticket aan, en `aios_tickets.review_item_id`
  // heeft een foreign key naar deze rij. Eerst antwoorden zou die insert laten
  // falen — en dan krijgt de bezoeker een bevestiging zonder ticket erachter.
  await store.saveReviewItem(result.reviewItem);

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
        model: env.MODEL_PLAN,
        outcome: outOfDomain ? 'gestopt op de domeingrens' : 'ReviewItem aangemaakt',
      },
    ],
    sources: result.sources ?? [],
    ungrounded: result.ungrounded,
    grounding: result.reviewItem.grounding ?? null,
    confidence: result.reviewItem.confidence ?? null,
    createdAt: new Date().toISOString(),
  };

  let reply: string | undefined;

  // Chat is realtime: er zit iemand te wachten, dus de beurt wordt hier
  // afgerond in plaats van in de werkbak. Wát de bezoeker krijgt, hangt af van
  // de uitkomst — zie chat/turn.ts. Bij mail gebeurt dit niet: daar blijft het
  // ReviewItem staan tot een mens 'm goedkeurt.
  //
  // Let op de volgorde: dit gaat vóór het beslislog en vóór het DONE-zetten.
  // Die zijn nodig voor de audit, maar de bezoeker wacht er niet op — en elke
  // schrijfactie ervóór is wachttijd die hij ziet.
  if (signal.domain === 'chat') {
    const payload = (signal.payload ?? {}) as { conversationId?: string };
    if (payload.conversationId) {
      try {
        const turn = await finishChatTurn(env, result.reviewItem, result.outcome, {
          outOfDomain: Boolean(outOfDomain),
          conversationId: payload.conversationId,
          category: result.classification.category,
        });
        if (turn) {
          reply = turn.reply;
          log.steps.push({ step: 'chat-turn', outcome: turn.reason });
        }
      } catch (err) {
        // De bezoeker krijgt dan niets terug, maar het ReviewItem staat in de
        // werkbak — een mens kan het alsnog oppakken.
        console.error('[chat] beurt afronden mislukt:', err);
        log.steps.push({ step: 'chat-turn', outcome: 'mislukt — staat in de werkbak' });
      }
    }
  }

  // Administratie ná het antwoord. Faalt dit, dan heeft de bezoeker zijn
  // antwoord al en zien wij de fout in de logs; andersom zou hij wachten op een
  // schrijfactie waar hij niets aan heeft.
  await store.saveDecisionLog(log);

  // Als laatste, en pas als de rest is gelukt: hiermee slaat de tweede route
  // deze beurt over. Faalt het markeren, dan draait de poller 'm nog eens —
  // vervelend, maar minder erg dan een bezoeker die niets krijgt omdat we een
  // mislukte run als afgehandeld hadden gemarkeerd.
  await store.markSignal(signal.id, 'DONE');

  return { reviewItemId: result.reviewItem.id, reply };
}
