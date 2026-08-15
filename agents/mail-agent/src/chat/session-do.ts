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

/**
 * Chatsessie als Durable Object (bouwbriefing §9.1).
 *
 * Eén object per sessie. Waarom een DO en geen databaserondje per bericht: een
 * bezoeker die snel achter elkaar typt levert anders race conditions op — twee
 * berichten die elkaars gespreksstand overschrijven. Een DO serialiseert dat
 * vanzelf, want er is er precies één per sessie.
 *
 * Wat dit object **niet** doet: beslissen. Het normaliseert een binnenkomend
 * bericht tot een Signal en zet dat op de work-bus; de lus (domeingrens →
 * router → specialist → beleidslaag) draait daarbuiten, precies zoals bij mail.
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

/** Terugvalwaarden als de bijbehorende `var` ontbreekt of onzin bevat. */
const DEFAULT_PER_MIN = 10;
const DEFAULT_PER_SESSION = 100;
const DEFAULT_MAX_CHARS = 2000;

/** Hoeveel eerdere berichten een (her)verbinding terugkrijgt. */
const HISTORY_LIMIT = 100;

interface SessionMessage {
  direction: 'inbound' | 'outbound';
  body: string;
  at: string;
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
      if (body) this.broadcast({ type: 'message', body });
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

    await db.request<unknown>(this.tenantCtx(), db.rpcUrl('aios_emit_signal'), {
      method: 'POST',
      body: JSON.stringify({
        p_org: this.env.AIOS_ORG_ID,
        p_domain: 'chat',
        p_type: 'chat.message',
        p_payload: {
          bodyText: body,
          from: contactEmail,
          conversationId,
          sessionId: this.sessionId(),
          ticketNumber,
          receivedDateTime: new Date().toISOString(),
        },
        // Eén signaal per bericht; de volgorde binnen de sessie is de
        // volgorde waarin de DO ze afhandelt.
        p_idempotency_key: `chat:${conversationId}:${seq}`,
      }),
    });

    // De poller meteen wekken. Zonder dit is de wachttijd van de bezoeker de
    // back-off van de poller (tot 30 seconden) of, als het alarm ooit stilviel,
    // die van de Cron (tot 5 minuten). Bij mail merkt niemand dat; hier zit
    // iemand in een chatvenster te kijken.
    //
    // Best-effort: mislukt het wekken, dan pikt het gewone alarm of de Cron het
    // alsnog op. Een bericht mag niet verloren gaan omdat de wekker het niet deed.
    try {
      await this.env.AIOS_POLLER.get(
        this.env.AIOS_POLLER.idFromName('aios-poller'),
      ).wake();
    } catch (err) {
      console.warn(
        '[chat] poller wekken mislukt:',
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
