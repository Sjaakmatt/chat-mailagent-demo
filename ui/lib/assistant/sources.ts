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
  makeSource,
  type AssistantSource,
} from "@factumai/agent-core";
import type { CockpitDbClient } from "@/lib/tenant-query";
import {
  getDecisionLog,
  listPolicyRules,
  listReviewRows,
  type PolicyRuleRow,
} from "@/lib/db";
import { listTickets } from "@/lib/tickets";
import { mailProposed } from "@/lib/modules/klantenservice";
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
export async function collectSources(
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
