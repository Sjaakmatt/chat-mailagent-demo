/**
 * De bronsystemen in demo-vorm: wat er gebeurt als een medewerker goedkeurt.
 *
 * ## Waarom dit in het fundament staat
 *
 * Om dezelfde reden als `migrations/0005_demo_testdata.sql`: een verse
 * klant-agent moet demonstreerbaar zijn vóór er één echte koppeling ligt. Bij
 * een echte klant vervangt de ERP-/CRM-MCP dit — de actietypen wijzen al naar
 * die tools, en de poorten, de agentcode en het goedkeurscherm veranderen niet
 * mee. Alleen het doelsysteem verschilt.
 *
 * ## Waarom dit achter DEMO_MODE zit
 *
 * Een demo-uitvoerder die per ongeluk aan staat op een productie-Worker schrijft
 * stilletjes in een demo-tabel terwijl iedereen denkt dat het in het ERP landt.
 * Dat is erger dan een fout, want het lijkt te werken. `DEMO_MODE` is dezelfde
 * vlag die de chat-testwidget aanzet, met dezelfde afspraak: op een
 * productie-Worker hoort die var niet gezet te zijn.
 *
 * Klantregistraties in `ACTION_EXECUTORS` gaan hier altijd vóór — die zijn
 * expliciet neergezet, deze zijn een vangnet.
 *
 * ## Idempotentie
 *
 * Elke schrijftabel heeft een unieke `idempotency_key`. Een Workflow-step mag
 * opnieuw draaien, en dan hoort dat dezelfde rij te raken in plaats van een
 * tweede creditnota van hetzelfde bedrag op te leveren. `merge-duplicates` op
 * die sleutel doet dat.
 */

import { SupabaseClient, ServiceRoleCredentialStore } from '@factumai/agent-core';
import type { TenantContext } from '@factumai/agent-core';
import type { Env } from '../env.js';
import { createTicket } from '../chat/tickets.js';
import type { ActionExecutionContext, ActionExecutor, PreconditionReader } from './execute.js';

const CTX: TenantContext = {
  organizationId: '_aios',
  agentId: 'aios-demo-systemen',
  toolCallId: 'aios-demo-systemen',
};

/** Staat de demo aan? Alleen de letterlijke waarde "true" telt. */
export function demoSystemsEnabled(env: Env): boolean {
  return (env.DEMO_MODE ?? '').trim().toLowerCase() === 'true';
}

function client(env: Env): SupabaseClient {
  return new SupabaseClient(
    new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
    { projectUrl: env.AIOS_SUPABASE_URL },
  );
}

/** Wat de run zelf al wist over de klant. Niet uit de payload van het model. */
interface RunFeiten {
  contactEmail: string | null;
  orderReference: string | null;
}

function schoon(waarde: unknown): string | null {
  return typeof waarde === 'string' && waarde.trim().length > 0 ? waarde.trim() : null;
}

/**
 * Het afzenderadres en het ordernummer van de run waar deze actie uit voortkwam.
 *
 * Allebei uit de run en niet uit de payload, en dat is geen detail. Het kanaal
 * leverde het adres aan en de classifier haalde het ordernummer uit het bericht;
 * dat zijn vastgestelde feiten. Een model dat ze moet overtypen kan ze verkeerd
 * overtypen, en dan gaat een ticket naar een adres dat nooit heeft gemaild.
 *
 * Bij een werkticket staan ze bovendien helemaal niet in de payload — dat type
 * kent alleen `subject` en `description`. Ze daar toch uitlezen leverde een
 * ticket op met "Geen ordernummer — navragen" terwijl het nummer gewoon in de
 * mail stond.
 *
 * Het ReviewItem is de bron: `proposed.original` is een kopie van de
 * signal-payload en `proposed.classification.extracted` bevat wat de classifier
 * eruit haalde. Eén read voor beide. Zonder ReviewItem valt hij terug op het
 * signaal, dat alleen het adres kent.
 */
async function runFeiten(ctx: ActionExecutionContext): Promise<RunFeiten> {
  const db = client(ctx.env);

  if (ctx.action.reviewItemId) {
    const url = db.tableUrl('aios_review_items');
    url.searchParams.set('id', `eq.${ctx.action.reviewItemId}`);
    url.searchParams.set('select', 'proposed');
    url.searchParams.set('limit', '1');
    const rijen = await db.request<Array<{ proposed: Record<string, unknown> }>>(CTX, url, {
      method: 'GET',
    });
    const proposed = Array.isArray(rijen) ? rijen[0]?.proposed : undefined;
    if (proposed) {
      const origineel = (proposed.original ?? {}) as { from?: unknown };
      const classificatie = (proposed.classification ?? {}) as {
        extracted?: { orderNumber?: unknown };
      };
      return {
        contactEmail: schoon(origineel.from),
        orderReference: schoon(classificatie.extracted?.orderNumber),
      };
    }
  }

  const url = db.tableUrl('aios_signals');
  url.searchParams.set('id', `eq.${ctx.action.runId}`);
  url.searchParams.set('select', 'payload');
  url.searchParams.set('limit', '1');
  const rijen = await db.request<Array<{ payload: { from?: unknown } }>>(CTX, url, {
    method: 'GET',
  });
  return {
    contactEmail: schoon(Array.isArray(rijen) ? rijen[0]?.payload?.from : undefined),
    orderReference: null,
  };
}

/** Leest een optionele string uit de payload; null als hij ontbreekt. */
function leesString(ctx: ActionExecutionContext, veld: string): string | null {
  const waarde = ctx.action.payload[veld];
  return typeof waarde === 'string' && waarde.trim().length > 0 ? waarde.trim() : null;
}

/** Leest één waarde uit de payload; gooit als hij ontbreekt of leeg is. */
function tekst(ctx: ActionExecutionContext, veld: string): string {
  const waarde = ctx.action.payload[veld];
  if (typeof waarde !== 'string' || waarde.trim().length === 0) {
    // Dit hoort niet te kunnen: `buildProposedActions` weigert een payload met
    // een ongedekt veld. Komt het tóch hier, dan is er iets stuk in de keten en
    // is stoppen beter dan een half record wegschrijven.
    throw new Error(`payload mist een bruikbare '${veld}'`);
  }
  return waarde.trim();
}

function getal(ctx: ActionExecutionContext, veld: string): number {
  const waarde = ctx.action.payload[veld];
  const n = typeof waarde === 'number' ? waarde : Number(waarde);
  if (!Number.isFinite(n)) throw new Error(`payload mist een bruikbaar getal '${veld}'`);
  return n;
}

/** Schrijft één rij, idempotent op de sleutel van deze actie. */
async function schrijf(
  ctx: ActionExecutionContext,
  tabel: string,
  rij: Record<string, unknown>,
): Promise<{ ref?: string }> {
  const db = client(ctx.env);
  const id = `${tabel}-${ctx.action.idempotencyKey}`;
  await db.request<unknown>(CTX, db.tableUrl(tabel), {
    method: 'POST',
    body: JSON.stringify({ ...rij, id, idempotency_key: ctx.action.idempotencyKey }),
    prefer: 'return=minimal,resolution=merge-duplicates',
  });
  return { ref: id };
}

export const DEMO_EXECUTORS: ActionExecutor[] = [
  {
    // Dit type is anders dan de rest: een werkticket landt niet in het systeem
    // van een klant maar in onze eigen werkbak. De registratie wijst naar de
    // tickets-MCP, en die route blijft gelden voor een klant die daarop draait;
    // zonder zo'n koppeling is `aios_tickets` het juiste doel, want dát is het
    // scherm waar de medewerker het ticket komt afhandelen.
    type: 'werkticket_aanmaken',
    async run(ctx) {
      const feiten = await runFeiten(ctx);
      const ticket = await createTicket(ctx.env, {
        organizationId: ctx.action.organizationId,
        // Geen chatgesprek: dit komt uit een mailrun. Het ReviewItem is de
        // koppeling terug naar het concept-antwoord en de onderbouwing.
        conversationId: null,
        reviewItemId: ctx.action.reviewItemId ?? null,
        category: null,
        summary: tekst(ctx, 'subject'),
        // Adres én ordernummer uit de run, niet uit de payload — zie
        // `runFeiten`. Een werkticket kent die velden niet eens in z'n payload.
        identity: feiten,
        handoverReason: leesString(ctx, 'description'),
      });
      if (!ticket) {
        // `ticketReadiness` eist een mailadres; zonder terugkoppelkanaal heeft
        // een ticket geen zin. Gooien in plaats van stil niets doen, anders
        // staat het voorstel op uitgevoerd zonder dat er iets bestaat.
        throw new Error('te weinig identificatie voor een ticket (mailadres ontbreekt)');
      }
      return { ref: ticket.number };
    },
  },
  {
    type: 'creditnota_voorstellen',
    async run(ctx) {
      const invoiceNumber = tekst(ctx, 'invoiceNumber');
      const ref = await schrijf(ctx, 'demo_credit_notes', {
        invoice_number: invoiceNumber,
        amount: getal(ctx, 'amount'),
        reason: typeof ctx.action.payload.reason === 'string' ? ctx.action.payload.reason : null,
      });
      // De factuur mee bijwerken, anders blijft hij `open` en stelt de agent
      // morgen dezelfde creditnota nog eens voor.
      const db = client(ctx.env);
      const url = db.tableUrl('demo_invoices');
      url.searchParams.set('invoice_number', `eq.${invoiceNumber}`);
      await db.request<unknown>(CTX, url, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'gecrediteerd' }),
        prefer: 'return=minimal',
      });
      return ref;
    },
  },
  {
    type: 'nalevering_aanmaken',
    run: (ctx) =>
      schrijf(ctx, 'demo_backorders', {
        order_number: tekst(ctx, 'orderNumber'),
        sku: tekst(ctx, 'sku'),
        quantity: getal(ctx, 'quantity'),
      }),
  },
  {
    type: 'onderzoek_vervoerder',
    run: (ctx) =>
      schrijf(ctx, 'demo_carrier_investigations', {
        tracking_code: tekst(ctx, 'trackingCode'),
        carrier: typeof ctx.action.payload.carrier === 'string' ? ctx.action.payload.carrier : null,
        reason: typeof ctx.action.payload.reason === 'string' ? ctx.action.payload.reason : null,
      }),
  },
  {
    type: 'adres_wijzigen',
    async run(ctx) {
      const orderNumber = tekst(ctx, 'orderNumber');
      const adres = ctx.action.payload.address;
      if (!adres || typeof adres !== 'object') throw new Error("payload mist 'address'");

      const db = client(ctx.env);
      // Eerst lezen, want `data` is één jsonb-document: blind patchen zou de
      // rest van de order overschrijven.
      const leesUrl = db.tableUrl('demo_orders');
      leesUrl.searchParams.set('order_number', `eq.${orderNumber}`);
      leesUrl.searchParams.set('select', 'data');
      leesUrl.searchParams.set('limit', '1');
      const rijen = await db.request<Array<{ data: Record<string, unknown> }>>(CTX, leesUrl, {
        method: 'GET',
      });
      const huidig = Array.isArray(rijen) ? rijen[0]?.data : undefined;
      if (!huidig) throw new Error(`order ${orderNumber} bestaat niet`);

      const schrijfUrl = db.tableUrl('demo_orders');
      schrijfUrl.searchParams.set('order_number', `eq.${orderNumber}`);
      await db.request<unknown>(CTX, schrijfUrl, {
        method: 'PATCH',
        body: JSON.stringify({ data: { ...huidig, shippingAddress: adres } }),
        prefer: 'return=minimal',
      });
      return { ref: `demo_orders-${orderNumber}` };
    },
  },
  {
    type: 'order_annuleren',
    async run(ctx) {
      const orderNumber = tekst(ctx, 'orderNumber');
      const db = client(ctx.env);
      const url = db.tableUrl('demo_orders');
      url.searchParams.set('order_number', `eq.${orderNumber}`);
      await db.request<unknown>(CTX, url, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
        prefer: 'return=minimal',
      });
      return { ref: `demo_orders-${orderNumber}` };
    },
  },
];

/**
 * De lookups voor de hervalidatie.
 *
 * Wat hier wordt teruggegeven, wordt veld voor veld vergeleken met de bewaarde
 * preconditie — maar alleen de velden die daarín stonden. Meer teruggeven is dus
 * veilig; minder niet, want een ontbrekend veld leest als "veranderd naar
 * undefined" en laat het voorstel afketsen.
 */
export const DEMO_PRECONDITION_READERS: PreconditionReader[] = [
  {
    kind: 'orderstatus',
    async read(ctx) {
      const orderNumber = ctx.action.payload.orderNumber;
      if (typeof orderNumber !== 'string') throw new Error("payload mist 'orderNumber'");
      const db = client(ctx.env);
      const url = db.tableUrl('demo_orders');
      url.searchParams.set('order_number', `eq.${orderNumber}`);
      url.searchParams.set('select', 'order_number,status,tracking_code');
      url.searchParams.set('limit', '1');
      const rijen = await db.request<
        Array<{ order_number: string; status: string; tracking_code: string | null }>
      >(CTX, url, { method: 'GET' });
      const rij = Array.isArray(rijen) ? rijen[0] : undefined;
      // Een verdwenen order is geen "geen wijziging" maar de sterkst mogelijke:
      // gooien, zodat het voorstel op mislukt komt in plaats van door te gaan.
      if (!rij) throw new Error(`order ${orderNumber} bestaat niet meer`);
      return {
        orderNumber: rij.order_number,
        status: rij.status,
        trackingCode: rij.tracking_code,
      };
    },
  },
  {
    kind: 'factuurstatus',
    async read(ctx) {
      const invoiceNumber = ctx.action.payload.invoiceNumber;
      if (typeof invoiceNumber !== 'string') throw new Error("payload mist 'invoiceNumber'");
      const db = client(ctx.env);
      const url = db.tableUrl('demo_invoices');
      url.searchParams.set('invoice_number', `eq.${invoiceNumber}`);
      url.searchParams.set('select', 'invoice_number,status,total_value');
      url.searchParams.set('limit', '1');
      const rijen = await db.request<
        Array<{ invoice_number: string; status: string; total_value: number | null }>
      >(CTX, url, { method: 'GET' });
      const rij = Array.isArray(rijen) ? rijen[0] : undefined;
      if (!rij) throw new Error(`factuur ${invoiceNumber} bestaat niet meer`);
      return {
        invoiceNumber: rij.invoice_number,
        status: rij.status,
        totalValue: rij.total_value,
      };
    },
  },
];
