/**
 * Wat een automatisering aan de werkbak levert om erin te mogen dokken.
 *
 * De werkbak is het fundament; klantenservice, sales, administratie en
 * operations zijn modules die erin hangen. Dit bestand is het contract, en het
 * belangrijkste eraan is wat er **niet** in staat: geen React-componenten, geen
 * kennis van mail, geen import uit een module. De schil rendert; de module
 * levert gegevens.
 *
 * Dat onderscheid is niet cosmetisch. Zou een module een eigen kaartcomponent
 * meebrengen, dan importeert de schil module-code en is de werkbak nooit los te
 * trekken. Nu levert een module een viewmodel, en blijft de kaart van de schil.
 *
 * **Eén uitzondering, bewust: het detailscherm.** Zie `DetailView` hieronder.
 * De viewmodel-regel houdt stand voor de kaart, waar elk item hetzelfde kleine
 * blokje is. Voor het detail houdt hij geen stand, en dat toegeven is beter dan
 * er een viewmodel omheen verzinnen dat elke module toch weer oprekt.
 *
 * Een module toevoegen: één bestand in `ui/lib/modules/`, en één regel in
 * `registry.ts`. De schil hoeft niet te veranderen.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { AssistantSource, ModuleId } from "@factumai/agent-core";
import type { CockpitDbClient } from "@/lib/tenant-query";
import type { DomainAuditSource } from "@/lib/audit-sources";
import type { ReviewCardViewModel, ReviewItemRow } from "@/lib/review";
import type { NavItem } from "@/lib/brand";
import type { AuthedAccess } from "@/lib/auth/access";

/** Eén categorie waarin deze module classificeert. */
export interface ModuleCategoryOption {
  slug: string;
  label: string;
}

/**
 * Wat de assistent van deze module mag raadplegen.
 *
 * Nu nog niet in gebruik — de assistent wordt in stap 3 van de bouwbriefing
 * gebouwd. Het staat er al omdat de vorm nú vastligt: de assistent is een
 * schil-functie die over de tabs heen kijkt, dus hij moet per module kunnen
 * weten welke bronnen bij welk proces horen. Zonder deze plek zou dat later
 * alsnog module-kennis in de schil worden.
 */
export interface ModuleAssistantScope {
  /**
   * De MCP's waaruit deze module zijn feiten haalt (bv. 'factumai-mcp-tickets').
   * De assistent bevraagt alleen wat bij de actieve module hoort.
   */
  mcps: readonly string[];
  /**
   * Bron-slugs in het beslislog die bij deze module horen. Bepaalt welke runs
   * de assistent mag uitleggen als hij in deze tab staat.
   */
  decisionLogSources: readonly string[];
}

export interface WorkbenchModule {
  id: ModuleId;
  /** Tabtitel in de werkbak. */
  label: string;
  /** Eén regel onder de tab: welk werk zit hier. */
  description: string;
  icon: LucideIcon;
  /**
   * De `kind`-waarden die deze module produceert. Gebruikt om items van vóór de
   * `module`-kolom alsnog in de juiste tab te krijgen.
   */
  kinds: readonly string[];
  /** Categorieën waarin deze module classificeert; voedt de beleidseditor. */
  categories: readonly ModuleCategoryOption[];
  /**
   * Maakt het kaart-viewmodel uit een ruwe rij. Dit is waar module-specifieke
   * kennis zit — welk veld het onderwerp is, wie de klant is, welke badges
   * ertoe doen — en het is meteen de enige plek waar dat mag zitten.
   */
  toCard(row: ReviewItemRow): ReviewCardViewModel;
  /** Waar de detailweergave van een item van deze module leeft. */
  detailHref(id: string): string;
  /**
   * Het detailscherm van een item van deze module.
   *
   * **Hier laten we de "een module levert geen React"-regel los**, met opzet en
   * met reden. Voor de kaart klopt die regel: elk item is daar hetzelfde
   * blokje met een titel, een ondertitel en wat badges, en een viewmodel dekt
   * dat. Voor het detail klopt hij niet. Een klantmail met een concept-antwoord,
   * een offerte met regels en marges, en een werkbon met onderdelen en uren zijn
   * geen varianten van één viewmodel — ze delen alleen dat er een mens naar
   * kijkt. Een gedeeld schema dat alle drie dekt, zou bij elke nieuwe module
   * opnieuw worden opgerekt tot het niets meer voorschrijft.
   *
   * De schil levert wél de omlijsting: de route, de rechtencontrole, en de
   * assistent in de zijkant. Wat daarbinnen staat is van de module.
   *
   * `user` gaat mee omdat een detailscherm meer toont aan wie meer mag — een
   * bedrag, een marge, een intern beslislog. De grens zelf zit niet hier maar in
   * `aios_role_grants`; dit is wat de module nodig heeft om ernaar te handelen.
   *
   * Mag `async` zijn: een detailscherm haalt zijn eigen aanvullingen op (de
   * tijdlijn, het beslislog, ondertekende bijlage-links) en welke dat zijn,
   * weet alleen de module. De schil haalt alleen de rij op.
   */
  DetailView(props: {
    row: ReviewItemRow;
    user: AuthedAccess;
  }): ReactNode | Promise<ReactNode>;
  /**
   * Verwerkt een bewerking van een reviewer terug in `proposed`.
   *
   * Bestaat omdat de beslisroute anders zelf moet weten wat een bewerking ís.
   * Die schreef `subject` en `body` — mailvelden — en zou een offerte met
   * gewijzigde regels mangelen tot een mail met een onderwerp.
   *
   * Krijgt de patch zoals het detailscherm hem stuurt en geeft de nieuwe
   * `proposed` terug. **Nooit muteren**: de oude waarde is wat er in de
   * edit-historie belandt, en die moet de wijziging overleven.
   */
  applyEdit(row: ReviewItemRow, patch: Record<string, unknown>): Record<string, unknown>;
  /**
   * De bronnen die de assistent bij een item van deze module mag lezen.
   *
   * Hier en niet in de assistent-laag, om dezelfde reden als `toCard`: zo kan
   * een module structureel alleen zijn éigen bronnen leveren. Zat dit in een
   * gedeelde functie met een module-parameter, dan hing de scheiding tussen
   * afdelingen aan het correct doorgeven van die parameter — en dat is precies
   * het soort grens dat een keer stukgaat.
   *
   * Geen implementatie = geen assistent voor deze module. Ook dat is
   * fail-closed: een nieuwe module krijgt niet per ongeluk een assistent die
   * bronnen van iemand anders leest.
   */
  collectSources?(
    client: CockpitDbClient,
    row: ReviewItemRow,
  ): Promise<AssistantSource[]>;
  /**
   * De bronnen die de assistent mag lezen zónder geopend voorstel.
   *
   * De assistent zit in de schil en niet op een detailscherm: een medewerker
   * kan hem aanspreken terwijl hij door de werkbak loopt, en dan is er geen rij
   * om context uit te halen. Wat hij dan mag inzien is nog steeds een keuze van
   * de módule — beleid en werkvoorraad van dit proces, niet van het proces
   * ernaast.
   *
   * Bewust een aparte functie en niet `collectSources` met een optionele rij.
   * De twee gesprekken zijn verschillend: bij een voorstel hoort een dossier
   * (deze klant, dit beslislog), zonder voorstel hoort de stand van het werk.
   * Eén functie met een `null` erin zou binnen twee takken uit elkaar vallen.
   *
   * Geen implementatie = geen assistent buiten een voorstel om. Fail-closed,
   * net als hierboven.
   */
  collectGeneralSources?(client: CockpitDbClient): Promise<AssistantSource[]>;
  /** Extra schermen van deze module in de zijbalk. */
  navItems?: readonly NavItem[];
  /** Eigen events op de auditlog-tijdlijn. */
  auditSource?: DomainAuditSource;
  /** Zie `ModuleAssistantScope`. */
  assistant?: ModuleAssistantScope;
}
