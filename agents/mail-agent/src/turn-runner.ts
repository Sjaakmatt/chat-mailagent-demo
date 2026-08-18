import {
  orchestrate,
  routingFor,
  type DecisionLog,
  type ProgressPhase,
  type Signal,
  type StepTiming,
} from '@factumai/agent-core';
import type { Env } from './env.js';
import { createPlatformStore } from './store.js';
import { buildOrchestrationSteps, buildLlmClient, hydrateSignal } from './steps.js';
import { finishChatTurn } from './chat/turn.js';
import { createTicket } from './chat/tickets.js';

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
 * bescherming draaien beide routes de hele lus en krijgt de bezoeker twee
 * antwoorden.
 *
 * Daarom claimt deze functie het signaal **vóór** het werk, met één UPDATE die
 * NEW naar PROCESSING zet. Postgres serialiseert dat, dus precies één van de
 * twee krijgt een rij terug; de ander stopt en geeft `null` terug. Achteraf
 * markeren volstaat niet — tussen het lezen en het klaar zijn zitten seconden,
 * en dat is precies het venster waarin de tweede route begint.
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
): Promise<TurnResult | null> {
  const store = createPlatformStore(env);

  // Claimen vóór het werk, niet DONE zetten erna. Dat verschil is het hele
  // punt: de chat-DO draait de beurt rechtstreeks en de poller start er een
  // Workflow op vanaf de wachtrij. Markeer je pas achteraf, dan is er een
  // venster van enkele seconden waarin allebei een signaal zien dat nog op NEW
  // staat — en dan krijgt de bezoeker twee antwoorden.
  if (!(await store.claimSignal(input.id))) {
    console.log(`[turn] ${input.id} was al geclaimd door de andere route — overgeslagen`);
    return null;
  }

  const llm = buildLlmClient(env);

  try {
    return await voerUit();
  } catch (err) {
    // De claim teruggeven, anders blijft dit signaal op PROCESSING staan en
    // pakt niemand het meer op. Nu kan de poller het opnieuw proberen.
    await store.markSignal(input.id, 'NEW').catch(() => {});
    throw err;
  }

  async function voerUit(): Promise<TurnResult> {
  // Bij mail haalt dit onderwerp en tekst op uit de mailbox; bij chat zit de
  // inhoud al in de payload en komt het signaal ongewijzigd terug.
  const signal = await hydrateSignal(env, input);

  const startedAt = Date.now();
  const timings: StepTiming[] = [];
  const result = await orchestrate(signal, {
    steps: buildOrchestrationSteps(env, llm),
    onProgress: opts.onProgress,
    onTiming: (t) => timings.push(t),
  });

  // Dit blijft vóór het antwoord staan, en dat is geen slordigheid: bij uitkomst
  // `taak` maakt `finishChatTurn` een ticket aan, en `aios_tickets.review_item_id`
  // heeft een foreign key naar deze rij. Eerst antwoorden zou die insert laten
  // falen — en dan krijgt de bezoeker een bevestiging zonder ticket erachter.
  await store.saveReviewItem(result.reviewItem);

  // Direct erna, en vóór het antwoord: `review_item_id` heeft een foreign key
  // naar de rij hierboven, en bij chat gaat de bevestiging zo de deur uit.
  //
  // Fail-soft, met opzet asymmetrisch. Er staat op dit moment nog niets in enig
  // bronsysteem — dat is het hele principe van een voorstel — dus een mislukte
  // opslag betekent alleen dat een medewerker het handmatig doet. Dat is
  // vervelend. De hele beurt laten klappen en de klant zonder antwoord laten
  // zitten is erger.
  if (result.actions && result.actions.length > 0) {
    try {
      await store.saveProposedActions(result.actions);
    } catch (err) {
      console.error('[acties] klaarzetten mislukt — geen voorstel in de werkbak:', err);
    }
  }

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
    // Het totaal én de opdeling. Het totaal blijft de regel waarop je sorteert;
    // de opdeling is wat een traag geval bruikbaar maakt. Zonder die tweede
    // vertelt een log van dertig seconden je alleen dát het traag was.
    steps: [
      {
        step: 'orchestrate',
        ms: Date.now() - startedAt,
        model: env.MODEL_PLAN,
        outcome: outOfDomain ? 'gestopt op de domeingrens' : 'ReviewItem aangemaakt',
      },
      ...timings.map((t) => ({ step: t.step, ms: t.ms })),
    ],
    sources: result.sources ?? [],
    ungrounded: result.ungrounded,
    grounding: result.reviewItem.grounding ?? null,
    confidence: result.reviewItem.confidence ?? null,
    createdAt: new Date().toISOString(),
  };

  // Wat er is klaargezet, en net zo belangrijk: wat níét en waarom. Zonder die
  // tweede helft staat er "geen actie" in de werkbak en kan niemand zien of er
  // niets te doen was of dat een bedrag geen dekking had.
  const klaargezet = result.actions ?? [];
  const geweigerd = result.rejectedActions ?? [];
  if (klaargezet.length > 0 || geweigerd.length > 0) {
    log.steps.push({
      step: 'acties',
      outcome: [
        klaargezet.length > 0
          ? `klaargezet: ${klaargezet.map((a) => a.type).join(', ')}`
          : 'niets klaargezet',
        ...geweigerd.map((r) => `geweigerd ${r.type}: ${r.reason}`),
        `identificatie: ${result.identification ?? 'onbekend'}`,
      ].join(' | '),
    });
  }

  // Bij mail hoort het uitzoekwerk ook in de ticketbak.
  //
  // Chat deed dit al (`finishChatTurn` bij uitkomst `taak`); mail niet, en dat
  // was een gat. De werkbak gaat over het goedkeuren van een concept-antwoord;
  // het uitzoeken — en de schrijfoperaties die daarbij horen — leeft in het
  // ticket. Zonder ticket had een klaargezette creditnota geen plek om aan te
  // hangen en stond hij op het werkitem, naast een concept waar hij niets mee
  // te maken heeft.
  //
  // Fail-soft: er staat nog niets in enig bronsysteem, dus een mislukt ticket
  // betekent handwerk. Dat is vervelend; de hele beurt laten klappen erger.
  const uitkomst = result.outcome?.outcome;
  if (signal.domain !== 'chat' && uitkomst && routingFor(uitkomst).createsTicket) {
    try {
      const origineel = (signal.payload ?? {}) as { from?: unknown };
      const ticket = await createTicket(env, {
        organizationId: signal.organizationId,
        conversationId: null,
        reviewItemId: result.reviewItem.id,
        category: result.classification.category,
        summary: result.reviewItem.summary,
        identity: {
          contactEmail: typeof origineel.from === 'string' ? origineel.from : null,
          orderReference:
            typeof result.classification.extracted.orderNumber === 'string'
              ? result.classification.extracted.orderNumber
              : null,
        },
        handoverReason:
          ((result.reviewItem.proposed as { policy?: { handoverReason?: string } }).policy
            ?.handoverReason) ?? null,
      });
      log.steps.push({
        step: 'ticket',
        outcome: ticket ? `ticket ${ticket.number}` : 'te weinig identificatie voor een ticket',
      });
    } catch (err) {
      console.error('[ticket] aanmaken mislukt:', err);
      log.steps.push({ step: 'ticket', outcome: 'aanmaken mislukt' });
    }
  }

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

          // En hiermee is dit item klaar.
          //
          // Zonder deze regel blijft elke chatbeurt als PENDING-concept in de
          // werkbak staan, terwijl het antwoord al bij de bezoeker is. Dat is
          // geen wachtrij meer maar een logboek dat zich als wachtrij voordoet:
          // een medewerker die zo'n item goedkeurt, keurt iets goed dat al
          // verstuurd is, en de teller "concepten wachten op review" loopt op
          // met elke vraag die de agent juist zelf heeft afgehandeld.
          //
          // Dat geldt voor álle vier de uitkomsten, want `finishChatTurn` geeft
          // alleen een resultaat terug als er daadwerkelijk iets naar de
          // bezoeker is gegaan:
          //
          //   kennis/systeem  het antwoord zelf is verstuurd
          //   taak            bevestiging verstuurd; het werk leeft verder in
          //                   het ticket, dat via `review_item_id` naar dit
          //                   item terugwijst — geen tweede wachtrij ernaast
          //   onbekend        de wedervraag is verstuurd
          //
          // Het item verdwijnt niet: als EXECUTED staat het op de audittijdlijn,
          // met `decided_by = 'agent'` zodat zichtbaar is dat hier geen mens aan
          // te pas kwam.
          //
          // Fail-soft: mislukt dit, dan staat het item er nog als concept. Dat
          // is vervelend maar onschadelijk — en zeker geen reden om een beurt te
          // laten klappen waarvan de bezoeker het antwoord al heeft.
          try {
            await store.markReviewItemHandled(result.reviewItem.id, 'agent');
          } catch (err) {
            console.error('[chat] item afsluiten mislukt (blijft als concept staan):', err);
          }
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
}
