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
