/**
 * VOORBEELD — magazijn/verzend-module (Sunwise).
 *
 * Dit hoort NIET in de kern. Het is de referentie-implementatie van een
 * klant-eigen domeinmodule die aanhaakt op de `domainHooks.afterExecute`
 * extensie-punt van de agent-Worker. Zie examples/warehouse-module/README.md.
 */

/** Eén onderdeel-batch die gold op de besteldatum (kleur + label + omschrijving). */
export interface ShipmentBatch {
  /** Onderdeel-categorie (moertjes, zuignappen, schroefjes…). */
  category?: string;
  label: string;
  color: string;
  notes?: string;
}

/** Eén te picken regel op het magazijn-werkticket. */
export interface ShipmentItem {
  sku?: string;
  name?: string;
  quantity?: number;
  /**
   * Batches die golden op de besteldatum. Eén SKU bestaat uit meerdere kleine
   * onderdelen (moertjes/zuignappen/schroefjes) die elk hun eigen batch hebben
   * en tegelijk actief kunnen zijn — daarom een lijst.
   */
  batches?: ShipmentBatch[];
}

/** Magazijn-/verzendtaak die de Execute-Workflow aanmaakt bij approve. */
export interface ShipmentTaskInput {
  id: string;
  organizationId: string;
  reviewItemId?: string | null;
  signalId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  orderReference?: string | null;
  description?: string | null;
  label?: string | null;
  items?: ShipmentItem[] | null;
  triggeredByRuleId?: string | null;
}

export interface OrderShipmentInfo {
  customerName?: string;
  customerEmail?: string;
  customerAddress?: string;
  items?: ShipmentItem[];
}

/**
 * Probeer de order via de ERP-MCP (WooCommerce-adapter in productie).
 * Geeft het ge-normaliseerde `SalesOrder`-vormige object terug zoals de
 * mock-tabel dat ook teruggeeft, of null als de MCP niets levert.
 */
async function loadOrderViaErpMcp(
  env: Env,
  orderNumber: string,
): Promise<Record<string, unknown> | null> {
  if (!env.FACTUMAI_MCP_ERP_URL) return null;
  const ctx: TenantContext = {
    organizationId: env.AIOS_ORG_ID,
    agentId: 'aios-agent',
    toolCallId: `order-${orderNumber}`,
  };
  const res = await callMcp<Record<string, unknown>>(
    { url: env.FACTUMAI_MCP_ERP_URL, apiKey: mcpBearer(env), cfAccess: cfAccessHeaders(env) },
    ctx,
    'erp_get_order',
    { orderNumber },
  );
  if (!res.ok || !res.data) return null;
  // De MCP geeft `SalesOrder` terug (camelCase, shippingAddress, items[]).
  // Dat is exact dezelfde vorm die de demo-tabel-fallback levert, dus de
  // bestaande mapping hieronder werkt ongewijzigd.
  return res.data;
}

/** Demo-tabel fallback (`demo_orders.data` jsonb) — werkte voorheen direct. */
async function loadOrderFromDemo(
  client: SupabaseClient,
  orderNumber: string,
): Promise<Record<string, unknown> | null> {
  const url = client.tableUrl('demo_orders');
  url.searchParams.set('order_number', `eq.${orderNumber}`);
  url.searchParams.set('select', 'data');
  url.searchParams.set('limit', '1');
  const rows = await client.request<Array<{ data: Record<string, unknown> }>>(
    STORE_CTX,
    url,
    { method: 'GET' },
  );
  return Array.isArray(rows) && rows[0]?.data ? rows[0].data : null;
}

/**
 * Haalt klant-/adres-/SKU-gegevens op voor het magazijn-werkticket.
 *
 * Voorkeur: ERP-MCP (`erp_get_order`) zodat de live WooCommerce-order de
 * bron is. Valt fail-soft terug op de `demo_orders`-tabel zodat de mail-
 * pipeline niet crasht als de MCP onbereikbaar is of (nog) geen WC-
 * credential voor deze tenant heeft (CLAUDE.md: nooit de mail-flow laten
 * vallen). De batch-resolve op besteldatum loopt onveranderd door.
 */
export async function loadOrderForShipment(
  env: Env,
  orderNumber: string,
): Promise<OrderShipmentInfo> {
  const client = new SupabaseClient(
    new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
    { projectUrl: env.AIOS_SUPABASE_URL },
  );

  const d = (await loadOrderViaErpMcp(env, orderNumber)) ??
    (await loadOrderFromDemo(client, orderNumber));
  if (!d) return {};

  const addr = d.shippingAddress as Record<string, unknown> | undefined;
  const customerAddress = addr
    ? [
        addr.street,
        `${addr.postalCode ?? ''} ${addr.city ?? ''}`.trim(),
        addr.country,
      ]
        .filter((p) => p && String(p).trim().length > 0)
        .join('\n')
    : undefined;

  const orderDate =
    typeof d.orderDate === 'string' ? d.orderDate.slice(0, 10) : undefined;

  const rawItems = Array.isArray(d.items)
    ? (d.items as Array<Record<string, unknown>>)
    : [];
  const items = await Promise.all(
    rawItems.map(async (it) => {
      const sku = typeof it.sku === 'string' ? it.sku : undefined;
      const base: ShipmentItem = {
        sku,
        name:
          typeof it.productName === 'string'
            ? it.productName
            : typeof it.name === 'string'
              ? it.name
              : undefined,
        quantity: typeof it.quantity === 'number' ? it.quantity : undefined,
      };
      // Batches die golden op besteldatum → magazijn pakt de juiste versie van
      // álle (kleine) onderdelen (moertjes/zuignapjes/schroeven) van deze SKU.
      if (sku && orderDate) {
        const batches = await batchesForSku(
          client,
          env.AIOS_ORG_ID,
          sku,
          orderDate,
        );
        if (batches.length > 0) base.batches = batches;
      }
      return base;
    }),
  );

  return {
    customerName: typeof d.customerName === 'string' ? d.customerName : undefined,
    customerEmail:
      typeof d.customerEmail === 'string' ? d.customerEmail : undefined,
    customerAddress,
    items: items.length > 0 ? items : undefined,
  };
}

/**
 * De batches die golden voor een SKU op een datum (start_date <= datum <=
 * end_date, end_date null = eeuwig). Eén SKU heeft meerdere onderdelen
 * (moertjes/zuignappen/schroefjes) die tegelijk actief kunnen zijn; per
 * categorie wint de nieuwste start bij overlap.
 */
async function batchesForSku(
  client: SupabaseClient,
  organizationId: string,
  sku: string,
  isoDate: string,
): Promise<ShipmentBatch[]> {
  const url = client.tableUrl('aios_part_batches');
  url.searchParams.set('organization_id', `eq.${organizationId}`);
  url.searchParams.set('sku', `eq.${sku}`);
  url.searchParams.set('start_date', `lte.${isoDate}`);
  url.searchParams.set('or', `(end_date.is.null,end_date.gte.${isoDate})`);
  url.searchParams.set('select', 'category,label,color,notes,start_date');
  url.searchParams.set('order', 'start_date.desc');
  const rows = await client.request<
    Array<{
      category: string | null;
      label: string;
      color: string;
      notes: string | null;
      start_date: string;
    }>
  >(STORE_CTX, url, { method: 'GET' });
  if (!Array.isArray(rows)) return [];
  // Per categorie de nieuwste (rijen zijn al start_date.desc) houden.
  const seen = new Set<string>();
  const out: ShipmentBatch[] = [];
  for (const r of rows) {
    const cat = r.category?.trim() ?? '';
    if (seen.has(cat)) continue;
    seen.add(cat);
    out.push({
      category: r.category ?? undefined,
      label: r.label,
      color: r.color,
      notes: r.notes ?? undefined,
    });
  }
  return out;
}

/**
 * Schrijft een verzendtaak (idempotent: id = `ship-<reviewItemId>`, merge-
 * duplicates). De magazijn-werkbak in de cockpit leest deze tabel.
 */
export async function createShipmentTask(
  env: Env,
  task: ShipmentTaskInput,
): Promise<void> {
  const client = new SupabaseClient(
    new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
    { projectUrl: env.AIOS_SUPABASE_URL },
  );
  const url = client.tableUrl('aios_shipment_tasks');
  await client.request<unknown>(STORE_CTX, url, {
    method: 'POST',
    body: JSON.stringify({
      id: task.id,
      organization_id: task.organizationId,
      review_item_id: task.reviewItemId ?? null,
      signal_id: task.signalId ?? null,
      status: 'OPEN',
      customer_email: task.customerEmail ?? null,
      customer_name: task.customerName ?? null,
      customer_address: task.customerAddress ?? null,
      order_reference: task.orderReference ?? null,
      description: task.description ?? null,
      label: task.label ?? null,
      items: task.items ?? null,
      triggered_by_rule_id: task.triggeredByRuleId ?? null,
      updated_at: new Date().toISOString(),
    }),
    prefer: 'return=minimal,resolution=merge-duplicates',
  });
}

