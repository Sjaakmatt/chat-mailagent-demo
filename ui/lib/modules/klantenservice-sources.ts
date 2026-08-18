/**
 * De bronnen die de assistent mag lezen bij één openstaand voorstel.
 *
 * Laag 1 uit de bouwbriefing: het dossier. Alles komt uit de klant-database —
 * er gaat hier geen MCP-call uit en er wordt niets geaggregeerd. Dat is laag 2
 * en dat is een ander product.
 *
 * Elke bron krijgt een id die de assistent moet citeren en die de cockpit
 * terugvertaalt naar een klikbare vindplaats. Zonder die id is een antwoord
 * niet controleerbaar, en een onControleerbaar antwoord is net zo goed
 * verzonnen.
 *
 * Wat hier NIET gebeurt: filteren op datacategorie. De cockpit leest zijn eigen
 * database, waarin geen ingekochte prijzen of marges staan — die zitten in de
 * bronsystemen achter de MCP's, en dáár snijdt de veldclassificatie ze weg. Bij
 * laag 2 komt die grens hier wel binnen, want dan lopen er wél MCP-calls
 * doorheen.
 */

import {
  KLANTENSERVICE_MODULE,
  makeSource,
  type AssistantSource,
  type Ticket,
} from "@factumai/agent-core";
import type { CockpitDbClient } from "@/lib/tenant-query";
import {
  getDecisionLog,
  listPolicyRules,
  listReviewRows,
  type PolicyRuleRow,
  type ReviewMetricRow,
} from "@/lib/db";
import { listTickets } from "@/lib/tickets";
import { mailProposed } from "./klantenservice";
import type { ReviewItemRow } from "@/lib/review";

/** Hoeveel vergelijkbare zaken we meesturen. Meer is ruis, niet meer context. */
const MAX_EERDERE_ZAKEN = 5;
const MAX_TICKETS = 5;

/** Het voorstel zelf: wat stelt de agent voor, en met welke zekerheid. */
function voorstelSource(row: ReviewItemRow): AssistantSource {
  const proposed = mailProposed(row);
  const regels = [
    `Status: ${row.status}`,
    `Samenvatting: ${row.summary}`,
    proposed.subject ? `Onderwerp: ${proposed.subject}` : null,
    row.confidence != null ? `Zekerheid: ${row.confidence}` : null,
    proposed.classification?.category
      ? `Categorie: ${proposed.classification.category}`
      : null,
    proposed.classification?.specialist
      ? `Specialist: ${proposed.classification.specialist}`
      : null,
    proposed.triage?.tier ? `Triage: ${proposed.triage.tier}` : null,
    proposed.triage?.reason ? `Triage-reden: ${proposed.triage.reason}` : null,
    proposed.noReply ? `Beleid: geen antwoord (${proposed.noReplyReason ?? "geen reden"})` : null,
    proposed.body ? `\nVoorgesteld antwoord:\n${proposed.body}` : null,
    proposed.original?.bodyText ? `\nOorspronkelijk bericht:\n${proposed.original.bodyText}` : null,
  ].filter((r): r is string => r !== null);

  return makeSource({
    id: `voorstel:${row.id}`,
    kind: "voorstel",
    label: "Dit voorstel",
    text: regels.join("\n"),
  });
}

/**
 * Het beslislog van de run die dit voorstel maakte.
 *
 * Dit is de bron voor "waarom stelt hij dit voor". Bewust volledig — juist de
 * afwijkingen (poort dicht, uitkomst gedegradeerd, claim afgekeurd) zijn wat
 * een medewerker wil weten, en die staan in de stappen en de ungrounded-lijst.
 */
async function beslislogSource(
  client: CockpitDbClient,
  reviewItemId: string,
): Promise<AssistantSource | null> {
  const log = await getDecisionLog(client, reviewItemId);
  if (!log) return null;

  const regels = [
    `Kanaal: ${log.channel}`,
    `Domeinpoort: ${log.inDomain ? "open" : `dicht (${log.domainReason ?? "geen reden"})`}`,
    log.category ? `Categorie: ${log.category}` : null,
    log.specialist ? `Specialist: ${log.specialist}` : null,
    log.outcome ? `Uitkomst: ${JSON.stringify(log.outcome)}` : null,
    log.confidence != null ? `Zekerheid na grounding: ${log.confidence}` : null,
    "",
    "Stappen:",
    ...log.steps.map(
      (s) =>
        `- ${s.step}${s.model ? ` (${s.model})` : ""}${s.ms != null ? ` ${s.ms}ms` : ""}${s.outcome ? `: ${s.outcome}` : ""}`,
    ),
    "",
    "Geraadpleegde bronnen:",
    ...(log.sources.length > 0
      ? log.sources.map((s) => `- ${s.tool} (${s.hit ? "raak" : "niets gevonden"})`)
      : ["- geen"]),
    log.ungrounded.length > 0
      ? `\nNiet herleidbare claims: ${log.ungrounded.join(", ")}`
      : "\nAlle claims herleidbaar.",
  ].filter((r): r is string => r !== null);

  return makeSource({
    id: `beslislog:${reviewItemId}`,
    kind: "beslislog",
    label: "Beslislog van deze run",
    href: `/mail/${encodeURIComponent(reviewItemId)}`,
    text: regels.join("\n"),
  });
}

/** Het beleid dat op de categorie van dit voorstel van toepassing is. */
function beleidSources(
  rules: PolicyRuleRow[],
  category: string | null | undefined,
): AssistantSource[] {
  // Regels zonder `applies_to` gelden overal; die horen er dus ook bij.
  const relevant = rules.filter(
    (r) =>
      r.enabled &&
      (r.applies_to.length === 0 || (category != null && r.applies_to.includes(category))),
  );

  return relevant.map((r) =>
    makeSource({
      id: `beleid:${r.id}`,
      kind: "beleid",
      label: `Beleidsregel "${r.name}"`,
      href: `/policy`,
      text: [
        `Naam: ${r.name}`,
        r.description ? `Toelichting: ${r.description}` : null,
        `Geldt voor: ${r.applies_to.length > 0 ? r.applies_to.join(", ") : "alle categorieën"}`,
        `Actie: ${r.action}`,
        `Prioriteit: ${r.priority}`,
        `Richtlijn: ${r.response_directive}`,
      ]
        .filter((x): x is string => x !== null)
        .join("\n"),
    }),
  );
}

/** Eerdere tickets van dezelfde klant — de klanthistorie. */
async function klanthistorieSources(
  client: CockpitDbClient,
  email: string | null,
): Promise<AssistantSource[]> {
  if (!email) return [];
  const tickets = await listTickets(client, { limit: 200 }).catch(() => []);
  const mine = tickets
    .filter((t) => t.contactEmail?.toLowerCase() === email.toLowerCase())
    .slice(0, MAX_TICKETS);

  return mine.map((t) =>
    makeSource({
      id: `ticket:${t.id}`,
      kind: "klanthistorie",
      label: `Ticket ${t.number}`,
      href: `/tickets`,
      text: [
        `Nummer: ${t.number}`,
        `Status: ${t.status}`,
        t.category ? `Categorie: ${t.category}` : null,
        `Samenvatting: ${t.summary}`,
        t.orderReference ? `Order: ${t.orderReference}` : null,
        `Aangemaakt: ${t.createdAt}`,
        t.closedAt ? `Afgesloten: ${t.closedAt} door ${t.closedBy ?? "onbekend"}` : null,
      ]
        .filter((x): x is string => x !== null)
        .join("\n"),
    }),
  );
}

/**
 * Eerder afgehandelde voorstellen in dezelfde categorie: is dit eerder
 * voorgekomen en wat is toen besloten.
 *
 * Alleen besliste items — een openstaand voorstel is geen precedent, dat is
 * dezelfde vraag die nog niemand heeft beantwoord.
 */
async function eerdereZakenSources(
  client: CockpitDbClient,
  category: string | null | undefined,
  huidigeId: string,
): Promise<AssistantSource[]> {
  if (!category) return [];
  const rows = await listReviewRows(client).catch(() => []);
  const eerder = rows
    .filter(
      (r) =>
        r.id !== huidigeId &&
        r.status !== "PENDING" &&
        r.category === category,
    )
    .slice(0, MAX_EERDERE_ZAKEN);

  return eerder.map((r) =>
    makeSource({
      id: `eerder:${r.id}`,
      kind: "eerdere_zaak",
      label: `Eerder afgehandeld: ${r.summary.slice(0, 60)}`,
      href: `/mail/${encodeURIComponent(r.id)}`,
      text: [
        `Samenvatting: ${r.summary}`,
        `Besluit: ${r.status}`,
        r.decided_by ? `Door: ${r.decided_by}` : null,
        r.decided_at ? `Op: ${r.decided_at}` : null,
        `Categorie: ${category}`,
      ]
        .filter((x): x is string => x !== null)
        .join("\n"),
    }),
  );
}

/**
 * Alle bronnen bij één voorstel.
 *
 * Faalt een losse bron, dan valt die weg en gaat de rest door — een assistent
 * die stilvalt omdat één query hapert is slechter dan een assistent die zegt
 * dat hij iets niet weet. Wat er ontbreekt is zichtbaar: de gebruiker ziet de
 * bronnenlijst.
 */
export async function collectKlantenserviceSources(
  client: CockpitDbClient,
  row: ReviewItemRow,
): Promise<AssistantSource[]> {
  const proposed = mailProposed(row);
  const category = proposed.classification?.category ?? null;
  const email =
    proposed.original?.from?.match(/<([^>]+)>/)?.[1] ??
    proposed.original?.from ??
    null;

  const [beslislog, rules, historie, eerder] = await Promise.all([
    beslislogSource(client, row.id).catch(() => null),
    listPolicyRules(client).catch((): PolicyRuleRow[] => []),
    klanthistorieSources(client, email),
    eerdereZakenSources(client, category, row.id),
  ]);

  return [
    voorstelSource(row),
    ...(beslislog ? [beslislog] : []),
    ...beleidSources(rules, category),
    ...historie,
    ...eerder,
  ];
}

// ---------------------------------------------------------------------------
// Generieke bronnen — het gesprek zonder geopend voorstel
// ---------------------------------------------------------------------------

/** Hoeveel open tickets er meegaan bij een generieke vraag. */
const MAX_OPEN_TICKETS = 15;
/** Hoeveel recent afgehandelde zaken er meegaan. */
const MAX_RECENT = 10;

/**
 * De werkvoorraad in cijfers.
 *
 * Bewust uitgeschreven per status en per categorie in plaats van als losse
 * getallen in de prompt: de assistent mag geen getal noemen dat niet letterlijk
 * in een bron staat, en hij mag niet rekenen. Wil je dat hij "er staan er zeven
 * open" kan zeggen, dan moet die zeven hier staan.
 */
function werkvoorraadSource(rows: ReviewMetricRow[]): AssistantSource {
  const perStatus = new Map<string, number>();
  const perCategorie = new Map<string, number>();
  for (const r of rows) {
    perStatus.set(r.status, (perStatus.get(r.status) ?? 0) + 1);
    if (r.status === "PENDING") {
      const c = r.category ?? "geen categorie";
      perCategorie.set(c, (perCategorie.get(c) ?? 0) + 1);
    }
  }

  const regels = [
    `Totaal aantal items in de werkbak: ${rows.length}`,
    "",
    "Per status:",
    ...[...perStatus.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `- ${s}: ${n}`),
    "",
    "Openstaand (PENDING) per categorie:",
    ...(perCategorie.size > 0
      ? [...perCategorie.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `- ${c}: ${n}`)
      : ["- niets openstaand"]),
  ];

  return makeSource({
    id: "werkvoorraad:klantenservice",
    kind: "werkvoorraad",
    label: "Werkvoorraad klantenservice",
    href: "/",
    text: regels.join("\n"),
  });
}

/**
 * De openstaande tickets — waar wordt nu aan gewerkt.
 *
 * `aios_tickets` is vandaag een tabel van deze module: tickets ontstaan uit een
 * klantenservice-run en er is geen tweede automatisering die erin schrijft.
 * Komt die er wel, dan hoort hier een modulekolom bij en een filter erop — net
 * als bij de review-items hierboven.
 */
function openTicketsSource(tickets: Ticket[]): AssistantSource | null {
  const open = tickets
    .filter((t) => t.status !== "DONE" && t.status !== "CANCELLED")
    .slice(0, MAX_OPEN_TICKETS);
  if (open.length === 0) return null;

  return makeSource({
    id: "tickets:open",
    kind: "werkvoorraad",
    label: `Openstaande tickets (${open.length})`,
    href: "/tickets",
    text: open
      .map((t) =>
        [
          `Ticket ${t.number} — ${t.status}`,
          t.category ? `  categorie: ${t.category}` : null,
          `  ${t.summary}`,
          t.orderReference ? `  order: ${t.orderReference}` : null,
          t.claimedBy ? `  opgepakt door: ${t.claimedBy}` : "  nog niet opgepakt",
          `  aangemaakt: ${t.createdAt}`,
        ]
          .filter((x): x is string => x !== null)
          .join("\n"),
      )
      .join("\n\n"),
  });
}

/** Wat er recent is besloten — voor "hoe doen we dit meestal". */
function recentBeslistSource(rows: ReviewMetricRow[]): AssistantSource | null {
  const beslist = rows.filter((r) => r.status !== "PENDING").slice(0, MAX_RECENT);
  if (beslist.length === 0) return null;

  return makeSource({
    id: "recent:beslist",
    kind: "eerdere_zaak",
    label: `Recent afgehandeld (${beslist.length})`,
    href: "/",
    text: beslist
      .map((r) =>
        [
          `${r.summary}`,
          `  besluit: ${r.status}${r.decided_by ? ` door ${r.decided_by}` : ""}`,
          r.category ? `  categorie: ${r.category}` : null,
          r.decided_at ? `  op: ${r.decided_at}` : null,
        ]
          .filter((x): x is string => x !== null)
          .join("\n"),
      )
      .join("\n\n"),
  });
}

/** De woordenlijst waarin deze module classificeert. */
function categorieSource(): AssistantSource {
  return makeSource({
    id: "taxonomie:klantenservice",
    kind: "beleid",
    label: "Categorieën van klantenservice",
    text: KLANTENSERVICE_MODULE.categories
      .map((c) => `- ${c.slug}: ${c.label}`)
      .join("\n"),
  });
}

/**
 * Hoort deze rij bij klantenservice?
 *
 * Eerst op `module`, want dat is wat de schrijver bedoelde; terugval op `kind`
 * voor items van vóór migratie 0030. Dit is dezelfde afweging als
 * `moduleForRow` in de registry, maar dan hier — de módule beslist wat van haar
 * is, want anders zou de schil per module moeten weten wat bij wie hoort.
 */
function vanDezeModule(r: ReviewMetricRow): boolean {
  if (r.module) return r.module === KLANTENSERVICE_MODULE.id;
  return (KLANTENSERVICE_MODULE.kinds as readonly string[]).includes(r.kind);
}

/**
 * De bronnen voor een gesprek zonder geopend voorstel.
 *
 * Dit is de assistent in de werkbak zelf: beleid, werkvoorraad, open tickets en
 * wat er recent is besloten. Geen klantdossier — dat hangt aan een voorstel, en
 * zonder voorstel is er geen klant om over te praten. Vraagt iemand er tóch
 * naar, dan is "dat staat er niet" het juiste antwoord: hij opent het item en
 * de assistent kijkt mee.
 *
 * Dezelfde fail-soft als hierboven: valt één query om, dan valt die bron weg en
 * gaat de rest door. Wat er ontbreekt is zichtbaar in de bronnenlijst.
 */
export async function collectKlantenserviceGeneralSources(
  client: CockpitDbClient,
): Promise<AssistantSource[]> {
  const [rules, tickets, rows] = await Promise.all([
    listPolicyRules(client).catch((): PolicyRuleRow[] => []),
    listTickets(client, { limit: 200 }).catch((): Ticket[] => []),
    listReviewRows(client, 200).catch((): ReviewMetricRow[] => []),
  ]);

  // Alles wat hier binnenkomt gaat door de modulezeef. Bij een voorstel is de
  // grens vanzelf goed — dat item hoort bij één module — maar een generieke
  // vraag leest lijsten, en een lijst kent de grens niet. Zonder deze filters
  // ziet een klantenservicemedewerker straks de sales-werkvoorraad in zijn
  // antwoord staan, zonder dat er ergens een rechtencheck is overgeslagen: de
  // bron was gewoon te breed.
  const mijn = rows.filter(vanDezeModule);
  const eigenCategorieen = new Set(
    KLANTENSERVICE_MODULE.categories.map((c) => c.slug),
  );
  const mijnRegels = rules.filter(
    (r) => r.applies_to.length === 0 || r.applies_to.some((c) => eigenCategorieen.has(c)),
  );

  const open = openTicketsSource(tickets);
  const recent = recentBeslistSource(mijn);

  return [
    werkvoorraadSource(mijn),
    ...(open ? [open] : []),
    // Alle regels van déze module: zonder voorstel is er geen categorie om op
    // te matchen, en "welk beleid geldt bij X" is juist de vraag die generiek
    // wordt gesteld. Regels zonder `applies_to` gelden overal en horen er dus
    // bij; regels die alleen op andermans categorieën slaan niet.
    ...beleidSources(mijnRegels, null),
    categorieSource(),
    ...(recent ? [recent] : []),
  ];
}
