/**
 * De demo-bronsystemen als leesbronnen voor de assistent.
 *
 * ## Waarom dit bestand bestaat, en waarom het hier staat en niet in het fundament
 *
 * De assistent las tot nu toe alleen de cockpit-database: voorstellen, beleid,
 * tickets, beslislogs. Voor een demo is dat te weinig. Een medewerker in de
 * werkbak vraagt "wat kost de kennisbank", "hoe ver staat DEMO-1004" en "welke
 * koppelingen hebben we" — en dat staat allemaal in de demo-tabellen, waar de
 * assistent niet bij kon. Het gevolg was een assistent die vrijwel overal "dat
 * staat er niet" op zei, terwijl het antwoord één tabel verderop lag.
 *
 * Bij een échte klant komt deze kennis uit de MCP's, met de veldclassificatie
 * ertussen die per rol wegsnijdt wat je niet mag zien. Dat is laag 2 en een
 * ander product. Deze bestanden zijn de demo-variant ervan, en horen dus in de
 * demo-repo: het fundament weet niets van `demo_orders`.
 *
 * ## Wat er NIET verandert
 *
 * De grounding-controle. Meer bronnen betekent dat de assistent meer kán
 * onderbouwen, niet dat hij minder hoeft te onderbouwen. Elke bewering wijst
 * nog steeds naar een bron-id, en een getal dat hier niet in staat haalt het
 * antwoord niet. Dat is in een demo geen obstakel maar het punt: je laat zien
 * dat het cijfer klopt én waar het vandaan komt.
 *
 * Alles hier is alleen-lezen; er zit geen mutatie in dit bestand.
 */

import { makeSource, type AssistantSource } from "@factumai/agent-core";
import type { CockpitDbClient } from "@/lib/tenant-query";

/** Rijen zoals de demo-tabellen ze teruggeven. `data` is het hele document. */
interface DemoRow {
  data: Record<string, unknown>;
}

const CTX = {
  organizationId: "_aios",
  agentId: "aios-cockpit",
  toolCallId: "aios-cockpit",
};

/**
 * Leest een demo-tabel.
 *
 * `tableUrlNoTenant` omdat de demo-tabellen geen `organization_id` hebben — ze
 * staan voor een bronsysteem dat buiten de cockpit leeft, precies zoals een ERP
 * dat ook niet per cockpit-tenant is ingedeeld. De naam is met opzet opvallend
 * zodat een grep alle plekken toont waar het tenant-filter niet meedraait.
 */
async function leesTabel(
  client: CockpitDbClient,
  tabel: string,
  select: string,
  extra?: (url: URL) => void,
): Promise<Record<string, unknown>[]> {
  const url = client.tableUrlNoTenant(tabel);
  url.searchParams.set("select", select);
  url.searchParams.set("limit", "50");
  extra?.(url);
  const rows = await client.request<DemoRow[]>(CTX, url, { method: "GET" });
  return (Array.isArray(rows) ? rows : [])
    .map((r) => r.data)
    .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object");
}

const tekst = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const getal = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Regels samenvoegen en lege eruit. */
const regels = (...r: (string | null)[]): string =>
  r.filter((x): x is string => x !== null).join("\n");

/**
 * Het assortiment.
 *
 * Compact gerenderd en niet als ruwe jsonb: de specs van 25 artikelen zouden de
 * prompt vullen met tabellen waar zelden naar wordt gevraagd, en dan verdringen
 * ze de bronnen die er wél toe doen. Naam, prijs, beschikbaarheid, waar het
 * voor is — dat is waar een medewerker naar vraagt.
 */
async function catalogusSources(
  client: CockpitDbClient,
): Promise<AssistantSource[]> {
  const items = await leesTabel(client, "demo_inventory", "data").catch(() => []);
  if (items.length === 0) return [];

  const perCategorie = new Map<string, string[]>();
  for (const p of items) {
    const cat = tekst(p.category) ?? "Overig";
    const lijst = perCategorie.get(cat) ?? [];
    lijst.push(
      regels(
        `- ${tekst(p.productName) ?? tekst(p.sku) ?? "naamloos"} (${tekst(p.sku) ?? "?"})`,
        tekst(p.tagline) ? `  ${tekst(p.tagline)}` : null,
        tekst(p.priceLabel) ? `  prijs: ${tekst(p.priceLabel)}` : null,
        tekst(p.availabilityLabel) ? `  ${tekst(p.availabilityLabel)}` : null,
        getal(p.leadTimeDays) ? `  doorlooptijd: ${getal(p.leadTimeDays)} dagen` : null,
      ),
    );
    perCategorie.set(cat, lijst);
  }

  // Eén bron per categorie, niet één grote. Het hele assortiment loopt over de
  // 4.000 tekens die een bron mag zijn, en dan kapt `makeSource` de laatste
  // categorieen af — precies de artikelen waar dan niets over te vinden is,
  // zonder dat iemand ziet dat ze zijn weggevallen. Bovendien citeert de
  // assistent nu "Assortiment: Koppelingen" en niet "de catalogus".
  return [...perCategorie.entries()].map(([cat, lijst]) =>
    makeSource({
      id: `demo:catalogus:${cat.toLowerCase()}`,
      kind: "klanthistorie",
      label: `Assortiment — ${cat} (${lijst.length})`,
      text: lijst.join("\n"),
    }),
  );
}

/** Eén traject, uitgeschreven. Ook los bruikbaar bij een geopend voorstel. */
function trajectTekst(
  order: Record<string, unknown>,
  tracking?: Record<string, unknown>,
): string {
  const items = Array.isArray(order.items) ? order.items : [];
  const mijlpalen = tracking && Array.isArray(tracking.mijlpalen) ? tracking.mijlpalen : [];

  return regels(
    `Traject: ${tekst(order.orderNumber) ?? "?"}`,
    tekst(order.company) ? `Klant: ${tekst(order.company)}` : null,
    tekst(order.customerName) ? `Contactpersoon: ${tekst(order.customerName)}` : null,
    tekst(order.customerEmail) ? `E-mail: ${tekst(order.customerEmail)}` : null,
    tekst(order.statusLabel) ?? tekst(order.status)
      ? `Status: ${tekst(order.statusLabel) ?? tekst(order.status)}`
      : null,
    getal(order.totalValue) !== null ? `Eenmalig: EUR ${getal(order.totalValue)}` : null,
    getal(order.maandbedrag) !== null ? `Maandbedrag: EUR ${getal(order.maandbedrag)}` : null,
    items.length > 0
      ? `Onderdelen:\n${items
          .map((i) => {
            const r = i as Record<string, unknown>;
            const opgeleverd =
              r.opgeleverd === false
                ? " — nog niet opgeleverd"
                : r.opgeleverd === true
                  ? " — opgeleverd"
                  : "";
            return `  - ${tekst(r.productName) ?? tekst(r.sku)} (${tekst(r.sku)}), eenmalig EUR ${getal(r.unitPrice) ?? "?"}, per maand EUR ${getal(r.monthly) ?? 0}${opgeleverd}`;
          })
          .join("\n")}`
      : null,
    mijlpalen.length > 0
      ? `Mijlpalen:\n${mijlpalen
          .map((m) => {
            const r = m as Record<string, unknown>;
            return `  - ${tekst(r.timestamp)?.slice(0, 10) ?? "?"}: ${tekst(r.status) ?? "?"}${tekst(r.toelichting) ? ` (${tekst(r.toelichting)})` : ""}`;
          })
          .join("\n")}`
      : null,
    tracking && tekst(tracking.volgendeMijlpaal)
      ? `Volgende mijlpaal: ${tekst(tracking.volgendeMijlpaal)}`
      : null,
    tracking && tekst(tracking.verwachteOplevering)
      ? `Verwachte oplevering: ${tekst(tracking.verwachteOplevering)}`
      : null,
  );
}

/** Alle lopende trajecten met hun mijlpalen. */
async function trajectenSource(
  client: CockpitDbClient,
): Promise<AssistantSource | null> {
  const [orders, tracking] = await Promise.all([
    leesTabel(client, "demo_orders", "data").catch(() => []),
    leesTabel(client, "demo_order_tracking", "data").catch(() => []),
  ]);
  if (orders.length === 0) return null;

  const perCode = new Map(
    tracking.map((t) => [tekst(t.trajectCode) ?? "", t] as const),
  );

  return makeSource({
    id: "demo:trajecten",
    kind: "klanthistorie",
    label: `Lopende trajecten (${orders.length})`,
    text: orders
      .map((o) => trajectTekst(o, perCode.get(tekst(o.trajectCode) ?? "")))
      .join("\n\n"),
  });
}

/** De openstaande facturen, met hun regels — de basis onder elke creditnota. */
async function facturenSource(
  client: CockpitDbClient,
): Promise<AssistantSource | null> {
  const facturen = await leesTabel(client, "demo_invoices", "data").catch(() => []);
  if (facturen.length === 0) return null;

  return makeSource({
    id: "demo:facturen",
    kind: "klanthistorie",
    label: `Facturen (${facturen.length})`,
    text: facturen.map(factuurTekst).join("\n\n"),
  });
}

function factuurTekst(f: Record<string, unknown>): string {
  const lines = Array.isArray(f.lines) ? f.lines : [];
  return regels(
    `Factuur ${tekst(f.invoiceNumber) ?? "?"} bij traject ${tekst(f.orderNumber) ?? "?"}`,
    tekst(f.customerEmail) ? `Klant: ${tekst(f.customerEmail)}` : null,
    tekst(f.soort) ? `Soort: ${tekst(f.soort)}${tekst(f.periode) ? ` (${tekst(f.periode)})` : ""}` : null,
    `Status: ${tekst(f.status) ?? "?"}`,
    getal(f.totalValue) !== null ? `Totaal: EUR ${getal(f.totalValue)}` : null,
    lines.length > 0
      ? `Regels:\n${lines
          .map((l) => {
            const r = l as Record<string, unknown>;
            return `  - ${tekst(r.description) ?? tekst(r.sku)}: EUR ${getal(r.lineTotal) ?? getal(r.unitPrice) ?? "?"}`;
          })
          .join("\n")}`
      : null,
  );
}

/** Wie de klanten zijn. */
async function klantenSource(
  client: CockpitDbClient,
): Promise<AssistantSource | null> {
  const klanten = await leesTabel(client, "demo_customers", "data").catch(() => []);
  if (klanten.length === 0) return null;

  return makeSource({
    id: "demo:klanten",
    kind: "klanthistorie",
    label: `Klanten (${klanten.length})`,
    text: klanten
      .map((k) =>
        regels(
          `${tekst(k.name) ?? "?"} <${tekst(k.email) ?? "?"}>`,
          tekst(k.company) ? `  Bedrijf: ${tekst(k.company)}` : null,
          tekst(k.role) ? `  Functie: ${tekst(k.role)}` : null,
          tekst(k.customerSince) ? `  Klant sinds: ${tekst(k.customerSince)}` : null,
        ),
      )
      .join("\n\n"),
  });
}

/**
 * De bronsystemen als bron, voor een gesprek zonder geopend voorstel.
 *
 * Fail-soft per bron: hapert er één query, dan valt die bron weg en gaat de
 * rest door. Wat ontbreekt is zichtbaar — de gebruiker ziet de bronnenlijst.
 */
export async function collectDemoSystemSources(
  client: CockpitDbClient,
): Promise<AssistantSource[]> {
  const [catalogus, rest] = await Promise.all([
    catalogusSources(client).catch((): AssistantSource[] => []),
    Promise.all([
      trajectenSource(client).catch(() => null),
      facturenSource(client).catch(() => null),
      klantenSource(client).catch(() => null),
    ]),
  ]);
  return [...catalogus, ...rest.filter((b): b is AssistantSource => b !== null)];
}

/**
 * Het traject en de factuur die bij één voorstel horen.
 *
 * Zoekt op het ordernummer dat de classificatie uit het bericht heeft gehaald.
 * Geen ordernummer betekent geen extra bronnen — en dat is de goede uitkomst:
 * dan is er ook geen traject om iets over te beweren.
 */
export async function collectDemoSourcesForOrder(
  client: CockpitDbClient,
  orderNumber: string | null,
): Promise<AssistantSource[]> {
  if (!orderNumber) return [];

  const [orders, tracking, facturen] = await Promise.all([
    leesTabel(client, "demo_orders", "data", (u) =>
      u.searchParams.set("order_number", `eq.${orderNumber}`),
    ).catch(() => []),
    leesTabel(client, "demo_order_tracking", "data").catch(() => []),
    leesTabel(client, "demo_invoices", "data", (u) =>
      u.searchParams.set("order_number", `eq.${orderNumber}`),
    ).catch(() => []),
  ]);

  const order = orders[0];
  if (!order) return [];

  const bij = tracking.find(
    (t) => tekst(t.trajectCode) === tekst(order.trajectCode),
  );

  return [
    makeSource({
      id: `demo:traject:${orderNumber}`,
      kind: "klanthistorie",
      label: `Traject ${orderNumber}`,
      text: trajectTekst(order, bij),
    }),
    ...facturen.map((f) =>
      makeSource({
        id: `demo:factuur:${tekst(f.invoiceNumber) ?? orderNumber}`,
        kind: "klanthistorie",
        label: `Factuur ${tekst(f.invoiceNumber) ?? "?"}`,
        text: factuurTekst(f),
      }),
    ),
  ];
}
