import { DurableObject } from 'cloudflare:workers';
import {
  SupabaseClient,
  ServiceRoleCredentialStore,
  findTicketNumber,
} from '@factumai/agent-core';
import type { Env } from '../env.js';

/**
 * Chatsessie als Durable Object (bouwbriefing §9.1).
 *
 * Eén object per sessie. Het houdt de gespreksgeschiedenis in geheugen en valt
 * weg bij afsluiting; bij afsluiting wordt de sessie weggeschreven naar
 * Supabase voor de logging.
 *
 * Waarom een DO en geen databaserondje per bericht: een bezoeker die snel
 * achter elkaar typt levert anders race conditions op — twee berichten die
 * elkaars gespreksstand overschrijven. Een DO serialiseert dat vanzelf, want
 * er is er precies één per sessie.
 *
 * Wat dit object **niet** doet: beslissen. Het normaliseert een binnenkomend
 * bericht tot een Signal en zet dat op de work-bus; de lus (domeingrens →
 * router → specialist → beleidslaag) draait daarbuiten, precies zoals bij mail.
 */

interface SessionMessage {
  direction: 'inbound' | 'outbound';
  body: string;
  at: string;
}

export class ChatSession extends DurableObject<Env> {
  /** In geheugen; de bron van waarheid tijdens de sessie. */
  private history: SessionMessage[] = [];
  private sockets = new Set<WebSocket>();
  private conversationId: string | null = null;
  private contactEmail: string | null = null;

  /** Naam van deze sessie = de naam waarmee de DO is opgevraagd. */
  private sessionId(): string {
    return this.ctx.id.name ?? this.ctx.id.toString();
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
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.sockets.add(server);

      server.addEventListener('message', (event) => {
        void this.onVisitorMessage(String(event.data));
      });
      const drop = () => this.sockets.delete(server);
      server.addEventListener('close', drop);
      server.addEventListener('error', drop);

      // Wat er al stond meesturen, zodat een herverbinding niet leeg begint.
      server.send(JSON.stringify({ type: 'history', messages: this.history }));

      return new Response(null, { status: 101, webSocket: client });
    }

    // De Execute-Workflow duwt het goedgekeurde antwoord hierlangs naar de
    // bezoeker. Losse route, want die draait in een andere isolate.
    if (url.pathname.endsWith('/push') && request.method === 'POST') {
      const { body } = (await request.json()) as { body?: string };
      if (body) this.pushToVisitor(body);
      return new Response(null, { status: 204 });
    }

    if (url.pathname.endsWith('/close') && request.method === 'POST') {
      await this.persist();
      for (const s of this.sockets) s.close(1000, 'sessie afgesloten');
      this.sockets.clear();
      return new Response(null, { status: 204 });
    }

    return new Response('Niet gevonden', { status: 404 });
  }

  /**
   * Een bericht van de bezoeker: opslaan in de geschiedenis en als Signal op de
   * work-bus zetten. Verder gebeurt hier niets — geen classificatie, geen
   * antwoord. Dat is precies de scheiding die maakt dat chat en mail dezelfde
   * lus delen.
   */
  private async onVisitorMessage(raw: string): Promise<void> {
    let text = raw;
    try {
      const parsed = JSON.parse(raw) as { body?: string; email?: string };
      if (typeof parsed.body === 'string') text = parsed.body;
      if (typeof parsed.email === 'string') this.contactEmail = parsed.email;
    } catch {
      // Platte tekst mag ook.
    }
    const body = text.trim();
    if (!body) return;

    this.history.push({ direction: 'inbound', body, at: new Date().toISOString() });

    await this.ensureConversation();

    // Noemt de bezoeker een ticketnummer, dan hoort dit bericht bij dat ticket
    // in plaats van bij een nieuw geval. De lus krijgt het mee als hint.
    const ticketNumber = findTicketNumber(body);

    const db = this.db();
    await db.request<unknown>(this.tenantCtx(), db.rpcUrl('aios_emit_signal'), {
      method: 'POST',
      body: JSON.stringify({
        p_org: this.env.AIOS_ORG_ID,
        p_domain: 'chat',
        p_type: 'chat.message',
        p_payload: {
          bodyText: body,
          from: this.contactEmail,
          conversationId: this.conversationId,
          sessionId: this.sessionId(),
          ticketNumber,
          receivedDateTime: new Date().toISOString(),
        },
        // Eén signaal per bericht; de volgorde binnen de sessie is de
        // volgorde waarin de DO ze afhandelt.
        p_idempotency_key: `chat:${this.conversationId}:${this.history.length}`,
      }),
    });
  }

  /** Duwt een antwoord naar alle openstaande sockets van deze sessie. */
  private pushToVisitor(body: string): void {
    this.history.push({ direction: 'outbound', body, at: new Date().toISOString() });
    const payload = JSON.stringify({ type: 'message', body });
    for (const s of this.sockets) {
      try {
        s.send(payload);
      } catch {
        this.sockets.delete(s);
      }
    }
  }

  /** Maakt het gesprek aan als dat er nog niet is. Idempotent op sessie-id. */
  private async ensureConversation(): Promise<void> {
    if (this.conversationId) return;
    const sessionId = this.sessionId();
    const id = `conv_chat_${sessionId}`;
    const db = this.db();
    await db.request<unknown>(this.tenantCtx(), db.tableUrl('aios_conversations'), {
      method: 'POST',
      body: JSON.stringify({
        id,
        organization_id: this.env.AIOS_ORG_ID,
        channel: 'chat',
        external_ref: sessionId,
        contact_email: this.contactEmail,
      }),
      prefer: 'return=minimal,resolution=merge-duplicates',
    });
    this.conversationId = id;
  }

  /**
   * Schrijft de sessie weg bij afsluiting. Best-effort: een sessie die niet
   * netjes wordt afgesloten (venster dicht) verliest hooguit de laatste
   * loggingregels, niet het gesprek zelf — dat staat al in `aios_messages`
   * via de bezorgroutine en de emit.
   */
  private async persist(): Promise<void> {
    if (!this.conversationId) return;
    try {
      const db = this.db();
      const url = db.tableUrl('aios_conversations');
      url.searchParams.set('id', `eq.${this.conversationId}`);
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
