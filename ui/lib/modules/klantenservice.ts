/**
 * De klantenservice-module: inkomende klantvragen via mail en chat.
 *
 * Dit is de enige plek in de cockpit waar mail-kennis mag zitten — welk veld
 * het onderwerp is, hoe je de afzender uit een gehydrateerde mail vist, welke
 * badges ertoe doen. Alles wat de werkbak van deze automatisering weet, komt
 * hiervandaan.
 *
 * Als sales erbij komt, is dat een bestand van deze vorm naast dit bestand plus
 * één regel in `registry.ts`. De schil verandert niet.
 */

import { ClipboardList, Inbox, MessagesSquare, ThumbsUp } from "lucide-react";
import { categoryLabelIn } from "@factumai/agent-core";
import { KLANTENSERVICE_MODULE } from "@factumai/agent-core/modules/klantenservice";
import {
  triageOf,
  type CardBadge,
  type ReviewCardViewModel,
  type ReviewItemRow,
} from "@/lib/review";
import type { WorkbenchModule } from "./contract";
import {
  collectKlantenserviceGeneralSources,
  collectKlantenserviceSources,
} from "./klantenservice-sources";
import {
  collectDemoSourcesForOrder,
  collectDemoSystemSources,
} from "./klantenservice-demo-sources";
import { klantenserviceAuditSource } from "./klantenservice-audit";

/**
 * De vorm van `proposed` bij een klantenservice-item.
 *
 * Stond eerder in `lib/review.ts` en daarmee in de schil. Hij hoort hier: een
 * werkbak die meerdere processen draagt, kan geen mailvorm in zijn kerntypes
 * hebben staan.
 */
export interface MailProposedContent {
  subject?: string;
  body?: string;
  /** Snapshot van de originele (gehydrateerde) mail die de agent verwerkte. */
  original?: {
    subject?: string;
    bodyText?: string;
    from?: string;
    messageId?: string;
    receivedDateTime?: string;
    thread?: {
      id?: string;
      from?: string;
      subject?: string;
      receivedDateTime?: string;
      bodyPreview?: string;
      isRead?: boolean;
    }[];
    attachments?: {
      id: string;
      name: string;
      contentType?: string;
      size?: number;
      path?: string | null;
      note?: string;
    }[];
    [key: string]: unknown;
  };
  /** Triage-uitkomst van de classify-stap. */
  classification?: {
    category?: string;
    confidence?: number;
    extracted?: Record<string, unknown>;
    /** Welke specialist het concept schreef (bij single-intent). */
    specialist?: string | null;
  };
  /** Toegepaste beleidsregel (cockpit-policy), indien gematcht. */
  policy?: {
    ruleId?: string;
    ruleName?: string;
    action?: string;
  };
  triage?: {
    tier?: string;
    reason?: string;
  };
  resolved?: {
    enrichment?: {
      messageId?: string;
      toEmail?: string;
    };
  };
  guardrail?: {
    ungroundedClaims?: string[];
  };
  /** Beleid 'no_reply': geen concept; bij approve wordt de mail opgeruimd. */
  noReply?: boolean;
  noReplyReason?: string;
  [key: string]: unknown;
}

/**
 * Leest `proposed` als klantenservice-inhoud. Gebruik dit in plaats van een
 * cast ter plekke: zo staat er precies één plek in de cockpit die aanneemt dat
 * een voorstel de mailvorm heeft.
 */
export function mailProposed(
  row: Pick<ReviewItemRow, "proposed">,
): MailProposedContent {
  return (row.proposed ?? {}) as MailProposedContent;
}

/**
 * SpecialistId (uit agent-core) → leesbaar label voor cockpit-badges.
 *
 * Stond eerder in `lib/review.ts`. Specialisten zijn een begrip van deze
 * module — sales heeft geen `complaint`-specialist — dus hoort de vertaling
 * hier. Onbekende slug valt terug op de slug zelf, zodat een experimentele
 * specialist zichtbaar blijft in plaats van te verdwijnen.
 */
export const SPECIALIST_LABELS: Record<string, string> = {
  simple_reply: "Simpel antwoord",
  order_change: "Orderwijziging",
  complaint: "Klacht",
  technical: "Technisch",
  gdpr: "Privacy / GDPR",
  escalate: "Escalatie",
};

export function specialistLabel(slug?: string | null): string | null {
  if (!slug) return null;
  return SPECIALIST_LABELS[slug] ?? slug;
}

const KIND_LABELS: Record<string, string> = {
  draft_email: "Concept",
  draft_reply: "Concept",
};

/** Waar de detailweergave van een klantenservice-item leeft. */
const detailHref = (id: string) => `/mail/${encodeURIComponent(id)}`;

/** Best-effort afzendernaam/-adres uit de gehydrateerde mail. */
function customerFrom(proposed: MailProposedContent): string | null {
  const raw =
    proposed.original?.from ??
    proposed.resolved?.enrichment?.toEmail ??
    proposed.original?.thread?.[0]?.from ??
    null;
  if (!raw) return null;
  // "Naam <mail@x.nl>" → "Naam"; kale mail → het mailadres zelf.
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : raw).trim() || null;
}

function badgesFor(row: ReviewItemRow, proposed: MailProposedContent): CardBadge[] {
  const badges: CardBadge[] = [];

  const category = categoryLabelIn(
    KLANTENSERVICE_MODULE,
    proposed.classification?.category,
  );
  if (category) badges.push({ label: category, tone: "neutral" });

  // Bij compound wint precedence_intent (aggregator-keuze); anders het
  // single-intent specialist-veld uit de classificatie.
  const specialist = specialistLabel(
    row.compound ? row.precedence_intent : (proposed.classification?.specialist ?? null),
  );
  if (specialist) badges.push({ label: specialist, tone: "accent" });

  const taskCount = row.tasks?.length ?? 0;
  if (taskCount > 0) {
    badges.push({ label: `${taskCount} deelvragen`, tone: "neutral" });
  }

  if (proposed.noReply) {
    badges.push({ label: "Geen antwoord", tone: "alert" });
  }

  return badges;
}

/**
 * Het ordernummer dat de classificatie uit het bericht heeft gehaald.
 *
 * Uit de run en niet uit de payload van een actie: een werkticket draagt geen
 * ordernummer, en dan zou "geen ordernummer" in het dossier belanden terwijl de
 * klant het gewoon genoemd heeft.
 */
function orderNumberOf(row: ReviewItemRow): string | null {
  const extracted = mailProposed(row).classification?.extracted;
  const nummer = extracted?.orderNumber;
  return typeof nummer === "string" && nummer.trim() ? nummer.trim() : null;
}

export const klantenserviceModule: WorkbenchModule = {
  id: KLANTENSERVICE_MODULE.id,
  label: KLANTENSERVICE_MODULE.label,
  description: KLANTENSERVICE_MODULE.description,
  icon: Inbox,
  kinds: KLANTENSERVICE_MODULE.kinds,
  categories: KLANTENSERVICE_MODULE.categories,
  detailHref,
  // Maatwerk van deze demo: naast de cockpit-bronnen uit het fundament leest
  // de assistent ook de demo-bronsystemen. Bij een echte klant komt die kennis
  // uit de MCP's; hier staat ze in `demo_*`. Zie
  // `klantenservice-demo-sources.ts` voor waarom dat verschil er is.
  async collectSources(client, row) {
    const [basis, uitBron] = await Promise.all([
      collectKlantenserviceSources(client, row),
      collectDemoSourcesForOrder(client, orderNumberOf(row)),
    ]);
    return [...basis, ...uitBron];
  },
  async collectGeneralSources(client) {
    const [basis, uitBron] = await Promise.all([
      collectKlantenserviceGeneralSources(client),
      collectDemoSystemSources(client),
    ]);
    return [...basis, ...uitBron];
  },
  toCard(row: ReviewItemRow): ReviewCardViewModel {
    const proposed = mailProposed(row);
    const triage = triageOf(row);
    return {
      id: row.id,
      module: KLANTENSERVICE_MODULE.id,
      kind: row.kind,
      kindLabel: KIND_LABELS[row.kind] ?? null,
      title: proposed.subject ?? row.summary,
      subtitle: customerFrom(proposed) ?? "Onbekende afzender",
      summary: row.summary,
      badges: badgesFor(row, proposed),
      href: detailHref(row.id),
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
      confidence: row.confidence,
      status: row.status,
      triage: triage.tier,
      triageReason: triage.reason,
    };
  },
  // De eigen schermen van deze module, naast de werkbak-tab.
  //
  // Deze stonden in `lib/brand.ts` bij de schil-navigatie, en dat was fout op
  // twee manieren. Inhoudelijk: het zijn klantenservice-schermen, dus dat is
  // mailkennis in een kernbestand van de cockpit. Praktisch: daar worden ze
  // alleen op rol gefilterd, dus iemand met alleen sales zag ze gewoon staan.
  //
  // Hier hangen ze aan de module, en toont de zijbalk ze alleen aan wie deze
  // afdeling heeft. Dat is nog steeds cosmetica — het echte weigeren doet
  // `requireModulePage` op de pagina's zelf.
  navItems: [
    { href: "/tickets", label: "Tickets", icon: ClipboardList },
    { href: "/gesprekken", label: "Gesprekken", icon: MessagesSquare },
    { href: "/feedback", label: "Feedback", icon: ThumbsUp },
  ],
  // Ticket-events op de auditlog-tijdlijn. De kern-auditlog toont wat er met
  // een voorstel gebeurde; dit toont wat er daarna met het uitzoekwerk
  // gebeurde — opgepakt door wie, afgesloten door wie.
  auditSource: klantenserviceAuditSource,
  assistant: {
    // Waar deze module zijn feiten vandaan haalt. De assistent (stap 3) mag in
    // deze tab alleen deze bronnen bevragen.
    mcps: ["factumai-mcp-mail", "factumai-mcp-tickets", "factumai-mcp-erp"],
    decisionLogSources: ["mail", "chat"],
  },
};
