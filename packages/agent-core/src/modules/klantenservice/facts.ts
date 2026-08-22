/**
 * De feitenbronnen van klantenservice — waar de cijfers vandaan komen.
 *
 * ## Wat een bron hier doet
 *
 * Vaststellen, niet interpreteren. Elke bron zegt of hij van toepassing is
 * (`input` geeft `null` als er niets op te halen valt), haalt op, en zet het
 * antwoord om in feiten die het model letterlijk mag citeren. Geen model in de
 * keten: wat hier uitkomt, is precies wat straks als waarheid geldt, en dat mag
 * dus geen gok zijn.
 *
 * ## De demo-tabellen zijn tijdelijk
 *
 * De bronnen wijzen vandaag naar `demo_orders`, `demo_inventory` en
 * `demo_invoices`. Dat is waar deze klant zijn gegevens heeft staan zolang er
 * geen koppeling is. Komt er een ERP- of webshop-MCP, dan verandert alleen
 * `source` — van `{ kind: 'table', table: 'demo_orders' }` naar
 * `{ kind: 'mcp', mcp: 'FACTUMAI_MCP_ERP_URL', tool: 'erp_get_order' }`. De
 * rest van de bron, en de hele lus eromheen, blijft staan.
 *
 * ## De volgorde is niet willekeurig
 *
 * `order.tracking` leunt op de code die uit `order.get` kwam. Bronnen draaien
 * in de volgorde waarin ze hier staan, dus een bron ziet alleen wat vóór hem
 * stond.
 */

import type { FactContext, FactDraft, FactProvider } from '../contract.js';

/**
 * Hoeveel artikelen er hooguit als feit meegaan.
 *
 * Bij een kleine catalogus is de hele lijst meesturen simpeler en
 * betrouwbaarder dan zoeken: geen zoekterm die net misgaat, geen artikel dat de
 * agent niet blijkt te kennen. Boven deze grens klopt die aanname niet meer en
 * hoort hier een echte zoekstap of een product-MCP. Dan valt de lijst af en zie
 * je dat in het log.
 */
const CATALOG_FACT_LIMIT = 40;

interface CatalogRow {
  sku: string;
  product_name: string;
  category: string | null;
  lead_time_days: number | null;
  data: Record<string, unknown> | null;
}

interface OrderRow {
  data: unknown;
  tracking_code: string | null;
  customer_email: string | null;
}

/** Het ordernummer dat de classifier eruit haalde, of null. */
function orderNumber(ctx: FactContext): string | null {
  const waarde = ctx.extracted.orderNumber;
  return typeof waarde === 'string' && waarde.trim() ? waarde.trim() : null;
}

/**
 * De catalogus.
 *
 * Alleen als er géén ordernummer is: dat betekent bijna altijd dat het over het
 * assortiment gaat en niet over een lopende bestelling. Levert twee feiten — de
 * lijst, zodat de agent weet wát er te koop is, en de volledige gegevens van de
 * artikelen die genoemd worden, want met alleen een naam en een prijs kun je
 * niet adviseren.
 */
export const CATALOG_FACTS: FactProvider = {
  name: 'catalog.list',
  description: 'Het assortiment, plus de volledige gegevens van genoemde artikelen.',
  source: { kind: 'table', table: 'demo_inventory' },
  dataCategories: ['operationeel', 'commercieel'],

  input(ctx) {
    if (orderNumber(ctx)) return null;
    return {
      select: 'sku,product_name,category,lead_time_days,data',
      order: 'category.asc,product_name.asc',
      // Eentje boven de grens vragen, zodat we kunnen zien dát er is afgekapt.
      limit: String(CATALOG_FACT_LIMIT + 1),
    };
  },

  toFacts(data, ctx) {
    const rijen = Array.isArray(data) ? (data as CatalogRow[]) : [];
    if (rijen.length === 0) return [];

    if (rijen.length > CATALOG_FACT_LIMIT) {
      console.warn(
        `[catalogus] meer dan ${CATALOG_FACT_LIMIT} artikelen — de lijst gaat niet ` +
          'meer volledig mee in de prompt. Bouw hier een zoekstap of een product-MCP.',
      );
    }

    const gebruikt = rijen.slice(0, CATALOG_FACT_LIMIT);
    const lijst = gebruikt.map((r) => ({
      sku: r.sku,
      naam: r.product_name,
      categorie: r.category,
      prijs: r.data?.priceLabel ?? null,
      prijsEenmalig: r.data?.priceOnce ?? null,
      prijsPerMaand: r.data?.priceMonthly ?? null,
      beschikbaarheid: r.data?.availabilityLabel ?? null,
      doorlooptijdDagen: r.lead_time_days,
      kort: r.data?.tagline ?? null,
      heeftNodig: r.data?.requires ?? [],
    }));

    const feiten: FactDraft[] = [
      {
        id: 'db.catalog',
        text: `Assortiment (${lijst.length} artikelen): ${JSON.stringify(lijst)}`,
      },
    ];

    const genoemd = genoemdeArtikelen(gebruikt, `${ctx.envelope.subject} ${ctx.envelope.body}`);
    if (genoemd.length > 0) {
      feiten.push({
        id: 'db.product',
        text: `Genoemde artikelen, volledig: ${JSON.stringify(genoemd)}`,
      });
    }
    return feiten;
  },
};

/**
 * De order bij het genoemde nummer.
 *
 * `customer_email` gaat mee, en dat is geen extraatje: dat adres tilt het van
 * "iemand noemt een nummer" naar "het bronsysteem knoopt dit adres aan deze
 * order". Zonder die bevestiging blijft de identificatie zwak en ontstaat er
 * geen schrijfactie — precies zoals bedoeld.
 */
export const ORDER_FACTS: FactProvider = {
  name: 'order.get',
  description: 'De order bij het genoemde ordernummer, met het adres uit de bron.',
  source: { kind: 'table', table: 'demo_orders' },
  dataCategories: ['operationeel'],

  input(ctx) {
    const nummer = orderNumber(ctx);
    if (!nummer) return null;
    return {
      order_number: `eq.${nummer}`,
      select: 'data,tracking_code,customer_email',
      limit: '1',
    };
  },

  toFacts(data, ctx) {
    const rij = eersteRij<OrderRow>(data);
    if (!rij?.data) return [];
    return [{ id: 'db.order', text: `Order ${orderNumber(ctx)}: ${JSON.stringify(rij.data)}` }];
  },
};

/** De zending bij de code die uit de order kwam. */
export const TRACKING_FACTS: FactProvider = {
  name: 'order.tracking',
  description: 'De zendingstatus bij de tracking-code van de order.',
  source: { kind: 'table', table: 'demo_order_tracking' },
  dataCategories: ['operationeel'],

  input(ctx) {
    const code = trackingCode(ctx);
    if (!code) return null;
    return { tracking_code: `eq.${code}`, select: 'data', limit: '1' };
  },

  toFacts(data, ctx) {
    const rij = eersteRij<{ data: unknown }>(data);
    if (!rij?.data) return [];
    return [
      { id: 'db.tracking', text: `Tracking ${orderNumber(ctx)}: ${JSON.stringify(rij.data)}` },
    ];
  },
};

/**
 * De factuur bij de order.
 *
 * Apart van de order en niet als veld erop: één order kan meer dan één factuur
 * hebben (deellevering, nalevering, correctie), en een creditnota hoort bij een
 * fáctuur. Zou dit uit de order komen, dan is "crediteer 89,95" niet te
 * herleiden naar wat er precies is gefactureerd — en dat is nu juist het veld
 * waar de onderbouwing aan hangt.
 */
export const INVOICE_FACTS: FactProvider = {
  name: 'invoice.get',
  description: 'De laatste factuur bij de order; nodig om een creditnota te onderbouwen.',
  source: { kind: 'table', table: 'demo_invoices' },
  dataCategories: ['operationeel', 'financieel'],

  input(ctx) {
    const nummer = orderNumber(ctx);
    if (!nummer) return null;
    return {
      order_number: `eq.${nummer}`,
      select: 'data',
      order: 'created_at.desc',
      limit: '1',
    };
  },

  toFacts(data, ctx) {
    const rij = eersteRij<{ data: unknown }>(data);
    if (!rij?.data) return [];
    return [
      {
        id: 'db.invoice',
        text: `Factuur bij order ${orderNumber(ctx)}: ${JSON.stringify(rij.data)}`,
      },
    ];
  },
};

/**
 * De bronnen van deze module, in de volgorde waarin ze draaien.
 *
 * De namen zijn wat een specialist in zijn `toolScope` zet. Staat een bron daar
 * niet in, dan wordt hij voor die specialist niet aangeroepen.
 */
export const KLANTENSERVICE_FACTS: readonly FactProvider[] = Object.freeze([
  CATALOG_FACTS,
  ORDER_FACTS,
  TRACKING_FACTS,
  INVOICE_FACTS,
]);

/** De tracking-code uit het antwoord van `order.get`, of null. */
export function trackingCode(ctx: FactContext): string | null {
  const rij = eersteRij<OrderRow>(ctx.results['order.get']);
  const code = rij?.tracking_code;
  return typeof code === 'string' && code.trim() ? code : null;
}

/**
 * Het adres dat het bronsysteem bij de order teruggaf.
 *
 * Staat hier en niet in de agent, want het hoort bij deze bron: wie de
 * ordertabel vervangt door een MCP, vervangt ook de plek waar dit adres
 * vandaan komt.
 */
export function sourceEmailFrom(results: Readonly<Record<string, unknown>>): string | null {
  const rij = eersteRij<OrderRow>(results['order.get']);
  const adres = rij?.customer_email;
  return typeof adres === 'string' && adres.trim() ? adres : null;
}

/**
 * De volledige gegevens van de artikelen die in de tekst worden genoemd.
 *
 * De match is bewust ruw — losse woorden van vier letters of meer uit de vraag,
 * naast productnaam en SKU. Een gemiste match kost een minder specifiek
 * antwoord, geen fout: de agent heeft de lijst nog steeds.
 */
function genoemdeArtikelen(rijen: CatalogRow[], tekst: string): Array<Record<string, unknown>> {
  const laag = tekst.toLowerCase();
  const treffers = rijen.filter((r) => {
    if (laag.includes(r.sku.toLowerCase())) return true;
    const naam = r.product_name.toLowerCase();
    if (laag.includes(naam)) return true;
    // Deelwoorden: "mailagent" vindt "Mailagent", "kennisbank" vindt "Kennisbank".
    return naam
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length >= 4)
      .some((w) => laag.includes(w));
  });
  // Boven de drie wordt het een opsomming in plaats van een advies; dan is de
  // vraag te breed en volstaat de lijst.
  return treffers.slice(0, 3).map((r) => ({
    sku: r.sku,
    naam: r.product_name,
    prijs: r.data?.priceLabel ?? null,
    beschikbaarheid: r.data?.availabilityLabel ?? null,
    specificaties: r.data?.specs ?? {},
    kernpunten: r.data?.kernpunten ?? [],
    heeftNodig: r.data?.requires ?? [],
    meerInfo: r.data?.url ?? null,
  }));
}

/** De eerste rij van een tabelantwoord. */
function eersteRij<T>(data: unknown): T | null {
  return Array.isArray(data) && data[0] ? (data[0] as T) : null;
}
