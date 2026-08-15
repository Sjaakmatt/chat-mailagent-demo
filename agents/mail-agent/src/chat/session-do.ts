import { DurableObject } from 'cloudflare:workers';
import {
  SupabaseClient,
  ServiceRoleCredentialStore,
  findTicketNumber,
  isOriginAllowed,
  evaluateRate,
  emptyRateState,
  parseVisitorMessage,
  readLimit,
  type ChatRateState,
} from '@factumai/agent-core';
import type { Env } from '../env.js';
import { runSignalTurn } from '../turn-runner.js';

/**
 * Chatsessie als Durable Object (bouwbriefing §9.1).
 *
 * Eén object per sessie. Waarom een DO en geen databaserondje per bericht: een
 * bezoeker die snel achter elkaar typt levert anders race conditions op — twee
 * berichten die elkaars gespreksstand overschrijven. Een DO serialiseert dat
 * vanzelf, want er is er precies één per sessie.
 *
 * Wat dit object doet: een binnenkomend bericht normaliseren tot een Signal,
 * dat op de work-bus zetten, en de lus er meteen zelf op draaien. Dat laatste
 * is het verschil met mail: daar zit niemand te wachten en gaat het via de
 * poller en een Workflow. Hier staat een bezoeker naar een leeg venster te
 * kijken, en dan is elke schakel ertussen puur wachttijd.
 *
 * Beslissen doet dit object nog steeds niet — de lus (domeingrens → router →
 * specialist → beleidslaag) zit in `turn-runner.ts` en is exact dezelfde code
 * die de Workflow draait.
 *
 * ## Hibernatie
 *
 * De sockets worden geaccepteerd met `ctx.acceptWebSocket()`, niet met
 * `ws.accept()`. Daarmee mag Cloudflare het object uit het geheugen halen
 * terwijl de verbinding openblijft, en betaal je niet voor een bezoeker die
 * z'n tabblad laat openstaan. De prijs is dat er **geen** staat in velden mag
 * leven: tussen twee berichten kan het object opnieuw zijn opgebouwd. Alles
 * wat een volgend bericht nodig heeft, staat daarom in `ctx.storage` of in de
 * database.
 *
 * Dat is geen omweg maar een verbetering: de gespreksgeschiedenis komt nu uit
 * `aios_messages` in plaats van uit een array in geheugen, en is daarmee
 * dezelfde bron die de cockpit toont.
 */

/**
 * Sleutels in de duurzame opslag. Stuk voor stuk dingen die een eviction
 * moeten overleven.
 */
const RATE_KEY = 'chat:rate';
const SEQ_KEY = 'chat:seq';
const EMAIL_KEY = 'chat:email';
const CONV_KEY = 'chat:conv-ready';
/**
 * Het gespreksvenster: de laatste beurten, in dit object.
 *
 * Waarom hier en niet uit `aios_messages`: de DO ís het geheugen van deze
 * sessie. `ctx.storage` overleeft hibernatie, staat naast de code en kost geen
 * netwerkrondje — en in het chatpad is elk rondje zichtbare wachttijd. De
 * database blijft de bron voor de cockpit en voor een herverbinding die de hele
 * geschiedenis wil; dit is de werkkopie voor de lus.
 */
const RECENT_KEY = 'chat:recent';

/** Terugvalwaarden als de bijbehorende `var` ontbreekt of onzin bevat. */
const DEFAULT_PER_MIN = 10;
const DEFAULT_PER_SESSION = 100;
const DEFAULT_MAX_CHARS = 2000;

/** Hoeveel eerdere berichten een (her)verbinding terugkrijgt. */
const HISTORY_LIMIT = 100;

/**
 * Hoeveel beurten de lus meekrijgt als context. Bewust kort: genoeg om
 * "en wanneer is het klaar?" aan het ordernummer van drie berichten eerder te
 * koppelen, kort genoeg om de prompt niet te laten dichtslibben met een gesprek
 * dat een uur duurt.
 */
const CONTEXT_TURNS = 10;

/**
 * Wat de bezoeker leest terwijl hij wacht. De lus levert een fase; de tekst
 * hoort hier, want die is kanaal- en taalgebonden.
 *
 * Eerlijk blijven: dit zijn de fasen die echt draaien, niet een animatie die
 * doet alsof er iets gebeurt. Gaat de agent niets opzoeken, dan ziet de
 * bezoeker die regel ook niet.
 */
const PROGRESS_TEXT: Record<string, string> = {
  routeren: 'even kijken waar dit over gaat…',
  opzoeken: 'ik zoek het voor je op…',
  schrijven: 'ik schrijf het antwoord…',
};

interface SessionMessage {
  direction: 'inbound' | 'outbound';
  body: string;
  at: string;
}

/** Eén beurt in het venster. Compact: dit gaat mee in een prompt. */
interface ContextTurn {
  role: 'klant' | 'agent';
  body: string;
}

interface MessageRow {
  direction: 'inbound' | 'outbound';
  body: string;
  created_at: string;
}

export class ChatSession extends DurableObject<Env> {
  /** Naam van deze sessie = de naam waarmee de DO is opgevraagd. */
  private sessionId(): string {
    return this.ctx.id.name ?? this.ctx.id.toString();
  }

  /** Deterministisch uit de sessie-id, dus zonder opslag te raadplegen. */
  private conversationId(): string {
    return `conv_chat_${this.sessionId()}`;
  }

  private db(): SupabaseClient {
    return new SupabaseClient(
      new ServiceRoleCredentialStore(this.env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
      { projectUrl: this.env.AIOS_SUPABASE_URL },
    );
  }

  /** Tenant-context voor DB-calls. Niet te verwarren met `this.ctx`,
   *  de DurableObjectState van het basisobject. */
  private tenantCtx() {
    return {
      organizationId: this.env.AIOS_ORG_ID,
      agentId: 'aios-chat',
      toolCallId: 'aios-chat',
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Verwacht een websocket-upgrade', { status: 426 });
      }

      // Wie mag deze widget insluiten? Alles buiten de allowlist krijgt de deur
      // dicht vóór er een socket open gaat — een geweigerde upgrade kost niets,
      // een open sessie wel.
      if (
        !isOriginAllowed(
          request.headers.get('Origin'),
          this.env.CHAT_ALLOWED_ORIGINS,
          url.origin,
        )
      ) {
        console.warn(
          `[chat] upgrade geweigerd voor origin=${request.headers.get('Origin') ?? '(geen)'}`,
        );
        return new Response('Origin niet toegestaan', { status: 403 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Hibernerend accepteren: het object mag uit het geheugen terwijl deze
      // socket openblijft. Berichten komen daarna binnen op `webSocketMessage`.
      this.ctx.acceptWebSocket(server);

      // Wat er al stond meesturen, zodat een herverbinding niet leeg begint.
      // Uit de database, niet uit geheugen — geheugen is er na hibernatie niet.
      void this.sendHistory(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    // De Execute-Workflow duwt het goedgekeurde antwoord hierlangs naar de
    // bezoeker. Losse route, want die draait in een andere isolate.
    if (url.pathname.endsWith('/push') && request.method === 'POST') {
      const { body } = (await request.json()) as { body?: string };
      if (body) {
        this.broadcast({ type: 'message', body });
        // Ook het antwoord hoort in het venster. Anders ziet de agent bij de
        // volgende beurt alleen de vragen van de klant en niet wat hij zelf al
        // heeft toegezegd — en herhaalt hij zichzelf of spreekt hij zichzelf tegen.
        await this.remember({ role: 'agent', body });
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname.endsWith('/close') && request.method === 'POST') {
      await this.touchConversation();
      for (const s of this.ctx.getWebSockets()) s.close(1000, 'sessie afgesloten');
      return new Response(null, { status: 204 });
    }

    return new Response('Niet gevonden', { status: 404 });
  }

  // -------------------------------------------------------------------------
  // Hibernatie-handlers. Deze vervangen de addEventListener-vorm: bij een
  // hibernerende socket bestaat het object tussen twee berichten mogelijk niet,
  // dus kán er geen listener op een instantie hangen.
  // -------------------------------------------------------------------------

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw =
      typeof message === 'string' ? message : new TextDecoder().decode(message);
    await this.onVisitorMessage(raw);
  }

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // Laatste socket dicht → gespreksstand bijwerken. Best-effort; het gesprek
    // zelf staat al in `aios_messages`.
    if (this.ctx.getWebSockets().length === 0) {
      await this.touchConversation();
    }
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.warn('[chat] socketfout:', error instanceof Error ? error.message : String(error));
  }

  /**
   * Een bericht van de bezoeker: bewaren en als Signal op de work-bus zetten.
   * Verder gebeurt hier niets — geen classificatie, geen antwoord. Dat is
   * precies de scheiding die maakt dat chat en mail dezelfde lus delen.
   */
  private async onVisitorMessage(raw: string): Promise<void> {
    const maxChars = readLimit(this.env.CHAT_MAX_MESSAGE_CHARS, DEFAULT_MAX_CHARS);
    const parsed = parseVisitorMessage(raw, maxChars);
    if (!parsed) {
      // Leeg is stil negeren; te lang verdient uitleg, anders lijkt de widget stuk.
      if (raw.trim().length > maxChars) {
        this.notify(`Je bericht is te lang. Houd het onder ${maxChars} tekens.`);
      }
      return;
    }
    const { body } = parsed;
    if (parsed.email) await this.ctx.storage.put(EMAIL_KEY, parsed.email);

    // Limiet vóór alles wat geld kost: een geweigerd bericht wordt geen Signal
    // en start dus geen lus. De telstand slaan we ook bij een afwijzing op,
    // want het venster kan intussen verlopen zijn.
    const now = Date.now();
    const prev =
      (await this.ctx.storage.get<ChatRateState>(RATE_KEY)) ?? emptyRateState(now);
    const decision = evaluateRate(prev, now, {
      perMinute: readLimit(this.env.CHAT_RATE_PER_MIN, DEFAULT_PER_MIN),
      perSession: readLimit(this.env.CHAT_MAX_PER_SESSION, DEFAULT_PER_SESSION),
    });
    await this.ctx.storage.put(RATE_KEY, decision.state);

    if (!decision.allowed) {
      console.warn(
        `[chat] bericht geweigerd (${decision.reason}) sessie=${this.sessionId()}`,
      );
      this.notify(
        decision.reason === 'per_minute'
          ? `Je stuurt te snel achter elkaar. Probeer het over ${Math.ceil(decision.retryAfterMs / 1000)} seconden nog eens.`
          : 'Dit gesprek heeft het maximale aantal berichten bereikt. Open een nieuw gesprek om verder te gaan.',
      );
      return;
    }

    await this.ensureConversation();

    // Volgnummer uit duurzame opslag, niet uit een teller in geheugen. Dat
    // laatste springt na een eviction terug naar nul, waarna het volgende
    // bericht een sleutel krijgt die al bestaat en stil als duplicaat
    // verdwijnt — de bezoeker typt dan en er gebeurt niets.
    const seq = ((await this.ctx.storage.get<number>(SEQ_KEY)) ?? 0) + 1;
    await this.ctx.storage.put(SEQ_KEY, seq);

    const conversationId = this.conversationId();
    const contactEmail = (await this.ctx.storage.get<string>(EMAIL_KEY)) ?? null;
    const db = this.db();

    // Het bericht van de bezoeker bewaren. Zonder dit toont de cockpit een half
    // gesprek: alleen de antwoorden van de agent, zonder de vragen. Stabiele
    // sleutel, dus opnieuw afleveren levert geen tweede rij op.
    await db.request<unknown>(this.tenantCtx(), db.tableUrl('aios_messages'), {
      method: 'POST',
      body: JSON.stringify({
        id: `msg-in-${conversationId}-${seq}`,
        organization_id: this.env.AIOS_ORG_ID,
        conversation_id: conversationId,
        direction: 'inbound',
        body,
        // `author` is voor uitgaand bedoeld (wie stuurde het namens ons); bij
        // inkomend staat de afzender op het gesprek.
        author: null,
      }),
      prefer: 'return=minimal,resolution=merge-duplicates',
    });

    // Noemt de bezoeker een ticketnummer, dan hoort dit bericht bij dat ticket
    // in plaats van bij een nieuw geval. De lus krijgt het mee als hint.
    const ticketNumber = findTicketNumber(body);

    // Het gesprek tot nu toe, vóórdat dit bericht erbij komt. Zonder dit
    // beantwoordt de agent elk bericht alsof het het eerste is: "en wanneer is
    // het klaar?" verliest dan het ordernummer van drie berichten eerder, en de
    // bezoeker moet zijn e-mailadres opnieuw geven. Dat is precies wat een chat
    // kapot maakt.
    const context = await this.recentTurns();
    await this.remember({ role: 'klant', body });

    // Eén keer opgebouwd en twee keer gebruikt: hij gaat naar de bus én
    // rechtstreeks de beurt in. Twee keer samenstellen is twee kansen om uit
    // elkaar te lopen.
    const payload: Record<string, unknown> = {
      bodyText: body,
      from: contactEmail,
      conversationId,
      sessionId: this.sessionId(),
      ticketNumber,
      receivedDateTime: new Date().toISOString(),
      ...(context.length > 0 ? { context } : {}),
    };

    const emitted = await db.request<Array<{ signal_id?: string }>>(
      this.tenantCtx(),
      db.rpcUrl('aios_emit_signal'),
      {
        method: 'POST',
        body: JSON.stringify({
          p_org: this.env.AIOS_ORG_ID,
          p_domain: 'chat',
          p_type: 'chat.message',
          p_payload: payload,
          // Eén signaal per bericht; de volgorde binnen de sessie is de
          // volgorde waarin de DO ze afhandelt.
          p_idempotency_key: `chat:${conversationId}:${seq}`,
        }),
      },
    );

    const signalId = Array.isArray(emitted) ? emitted[0]?.signal_id : undefined;
    if (signalId) await this.startTurn(signalId, seq, payload);
  }

  /**
   * Draait de beurt hier, in dit object, in plaats van hem ergens neer te
   * leggen en te wachten.
   *
   * ## Waarom chat niet via de wachtrij en niet via een Workflow gaat
   *
   * Bij mail is dat pad precies goed: er zit niemand te wachten, dus
   * duurzaamheid mag boven snelheid. Bij chat staat er iemand naar een leeg
   * venster te kijken, en dan is elke schakel ertussen puur wachttijd. De
   * wachtrij kost de back-off van de poller; een Workflow-instantie kost
   * aanmaken en inplannen vóórdat de eerste LLM-call begint. Geen van beide
   * levert de bezoeker iets op.
   *
   * Wat we ervoor inleveren is de hervatbaarheid van een Workflow. Dat is hier
   * een goede ruil: het signaal staat al op de bus, dus valt dit object om
   * midden in een beurt, dan pakt de poller het alsnog op. De bezoeker wacht
   * dan langer, maar zijn vraag is niet weg.
   *
   * `runSignalTurn` is dezelfde functie die de Workflow draait. Eén
   * implementatie, twee aanroepers — chat en mail kunnen niet uit elkaar lopen.
   */
  private async startTurn(signalId: string, seq: number, payload: Record<string, unknown>): Promise<void> {
    try {
      await runSignalTurn(
        this.env,
        {
          id: signalId,
          organizationId: this.env.AIOS_ORG_ID,
          domain: 'chat',
          type: 'chat.message',
          // Dezelfde payload als op de bus. Bewust niet eerst uit de database
          // lezen: dat is een rondje netwerk voor iets wat we net zelf hebben
          // weggeschreven, en dat is precies de wachttijd die we hier weghalen.
          payload,
          status: 'NEW',
          idempotencyKey: `chat:${this.conversationId()}:${seq}`,
          receivedAt: new Date().toISOString(),
        },
        {
          // Wát de agent aan het doen is, in de taal van de bezoeker. Drie
          // fasen is genoeg: meer stappen tonen leest als een voortgangsbalk
          // die zichzelf serieuzer neemt dan het wachten waard is.
          onProgress: (phase) => {
            this.broadcast({ type: 'status', body: PROGRESS_TEXT[phase] });
          },
        },
      );
    } catch (err) {
      // Niet doorgooien: het signaal staat op de bus, dus de poller pakt het op
      // en de bezoeker krijgt alsnog antwoord — later. Wel luid loggen, want
      // dit is het verschil tussen "snel" en "uiteindelijk".
      console.error(
        '[chat] directe beurt mislukt, valt terug op de wachtrij:',
        err instanceof Error ? err.message : String(err),
      );
      this.notify(
        'Het duurt even langer dan normaal. Ik ben er nog mee bezig — je krijgt zo antwoord.',
      );
    }
  }

  /** Het gespreksvenster zoals het nu in de opslag staat. */
  private async recentTurns(): Promise<ContextTurn[]> {
    const stored = await this.ctx.storage.get<ContextTurn[]>(RECENT_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  /**
   * Zet een beurt in het venster en gooit het oudste eruit. Best-effort: lukt
   * het schrijven niet, dan verliest de agent context maar valt het gesprek
   * niet om.
   */
  private async remember(turn: ContextTurn): Promise<void> {
    try {
      const next = [...(await this.recentTurns()), turn].slice(-CONTEXT_TURNS);
      await this.ctx.storage.put(RECENT_KEY, next);
    } catch (err) {
      console.warn(
        '[chat] context bijwerken mislukt:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Stuurt het verloop tot nu toe naar één socket, uit de database. */
  private async sendHistory(ws: WebSocket): Promise<void> {
    let messages: SessionMessage[] = [];
    try {
      const db = this.db();
      const url = db.tableUrl('aios_messages');
      url.searchParams.set('conversation_id', `eq.${this.conversationId()}`);
      url.searchParams.set('order', 'created_at.asc');
      url.searchParams.set('limit', String(HISTORY_LIMIT));
      const rows = await db.request<MessageRow[]>(this.tenantCtx(), url, {
        method: 'GET',
      });
      if (Array.isArray(rows)) {
        messages = rows.map((r) => ({
          direction: r.direction,
          body: r.body,
          at: r.created_at,
        }));
      }
    } catch (err) {
      // Een lege geschiedenis is vervelend maar niet fataal; de sessie werkt
      // verder gewoon. Stilvallen zou erger zijn.
      console.warn(
        '[chat] geschiedenis ophalen mislukt:',
        err instanceof Error ? err.message : String(err),
      );
    }

    try {
      ws.send(JSON.stringify({ type: 'history', messages }));
    } catch {
      // Socket alweer dicht — niets aan de hand.
    }
  }

  /** Duwt een payload naar alle openstaande sockets van deze sessie. */
  private broadcast(payload: Record<string, unknown>): void {
    const text = JSON.stringify(payload);
    for (const s of this.ctx.getWebSockets()) {
      try {
        s.send(text);
      } catch {
        // Dichte socket; Cloudflare ruimt 'm zelf op.
      }
    }
  }

  /**
   * Een mededeling aan de bezoeker die géén onderdeel van het gesprek is —
   * een limiet, een afwijzing. Bewust een eigen `type`, zodat een widget 'm
   * anders kan tonen dan een antwoord van de agent, en bewust niet in
   * `aios_messages`: het is geen gespreksinhoud en hoort niet in de logging.
   */
  private notify(body: string): void {
    this.broadcast({ type: 'notice', body });
  }

  /** Maakt het gesprek aan als dat er nog niet is. Idempotent op sessie-id. */
  private async ensureConversation(): Promise<void> {
    if (await this.ctx.storage.get<boolean>(CONV_KEY)) return;

    const db = this.db();
    await db.request<unknown>(this.tenantCtx(), db.tableUrl('aios_conversations'), {
      method: 'POST',
      body: JSON.stringify({
        id: this.conversationId(),
        organization_id: this.env.AIOS_ORG_ID,
        channel: 'chat',
        external_ref: this.sessionId(),
        contact_email: (await this.ctx.storage.get<string>(EMAIL_KEY)) ?? null,
      }),
      prefer: 'return=minimal,resolution=merge-duplicates',
    });
    await this.ctx.storage.put(CONV_KEY, true);
  }

  /**
   * Werkt de gespreksstand bij. Best-effort: een sessie die niet netjes wordt
   * afgesloten (venster dicht) verliest hooguit een tijdstempel, niet het
   * gesprek — dat staat bericht voor bericht in `aios_messages`.
   */
  private async touchConversation(): Promise<void> {
    if (!(await this.ctx.storage.get<boolean>(CONV_KEY))) return;
    try {
      const db = this.db();
      const url = db.tableUrl('aios_conversations');
      url.searchParams.set('id', `eq.${this.conversationId()}`);
      await db.request<unknown>(this.tenantCtx(), url, {
        method: 'PATCH',
        body: JSON.stringify({ last_message_at: new Date().toISOString() }),
        prefer: 'return=minimal',
      });
    } catch (err) {
      console.warn('[chat] sessie wegschrijven mislukt:', err);
    }
  }
}
