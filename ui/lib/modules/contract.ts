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
 * Een module toevoegen: één bestand in `ui/lib/modules/`, en één regel in
 * `registry.ts`. De schil hoeft niet te veranderen.
 */

import type { LucideIcon } from "lucide-react";
import type { AssistantSource, ModuleId } from "@factumai/agent-core";
import type { CockpitDbClient } from "@/lib/tenant-query";
import type { DomainAuditSource } from "@/lib/audit-sources";
import type { ReviewCardViewModel, ReviewItemRow } from "@/lib/review";
import type { NavItem } from "@/lib/brand";

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
