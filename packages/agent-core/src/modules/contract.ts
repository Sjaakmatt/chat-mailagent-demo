/**
 * Het modulepakket — wat een automatisering aan de kern levert om te mogen
 * draaien.
 *
 * ## Waarom dit bestaat
 *
 * Tot fase 1 stond alle domeinkennis globaal: één `CATEGORIES`, één `DOMAIN`,
 * één `CORE_INTENTS`, één `ACTION_TYPES`. Allemaal over een webshop. Zet je
 * administratie ernaast, dan wijst de poort een crediteurenvraag af als buiten
 * scope, kiest de router een klantenservice-specialist, en matcht het beleid op
 * een categorie die in dat proces iets anders betekent. Er was geen plek waar
 * stond: *dit signaal hoort bij deze module, gebruik háár gate, taxonomie en
 * specialisten.*
 *
 * Dit bestand is die plek. **Een module is geen tab, een module is een
 * pakket**: alles wat een domein tot een domein maakt zit in één object dat de
 * kern uitleest. De kern kent daarna geen enkele module bij naam — alleen de
 * registry doet dat, en die wordt gegenereerd.
 *
 * ## De andere helft
 *
 * De UI-kant (tab, kaart, detail-link, auditbron) blijft in `ui/lib/modules/`.
 * Bewust gescheiden: de agent-Worker heeft geen React nodig en de cockpit heeft
 * geen lus-kennis nodig. Zie `docs/MODULES.md`.
 */

import type {
  ReviewItemKind,
  Signal,
  SpecialistId,
} from '../contracts/index.js';
import type { ActionTypeDef } from '../actions/index.js';
import type { ChannelId } from '../channels/index.js';
import type { DataCategory } from '../access/grants.js';
import type { DomainConfig } from '../domain-gate/index.js';
import type { ModelConfig } from '../llm/index.js';
import type { IdentificationPolicy, Outcome } from '../outcomes/index.js';
import type { IntentConfig } from '../specialists/index.js';
import type { CategoryDef } from '../taxonomy/index.js';
import type { SignalEnvelope } from '../envelope/index.js';
import type { ModuleTriggers } from '../triggers/index.js';
import type { ModuleDescriptor } from './index.js';

/**
 * Welke signalen deze module claimt.
 *
 * `domain` is verplicht, `type` mag weg als de module elk type binnen dat
 * domein aankan. `when` is de uitweg voor het geval dat straks onvermijdelijk
 * is: administratie en klantenservice krijgen allebei `mail.received`, en dan
 * is het de inhoud die beslist. Zolang domein en type volstaan, laat je 'm weg
 * — een predicaat is code die je moet lezen om te weten wie wat krijgt.
 */
export interface SignalClaim {
  /** mail | chat | erp | bank | schedule | ... */
  domain: string;
  /** mail.received | invoice.due | schedule.<naam> | ... Weglaten = elk type. */
  type?: string;
  /** Laatste zeef als domein en type niet onderscheidend genoeg zijn. */
  when?(signal: Signal): boolean;
}

/**
 * Waar deze module zijn feiten haalt.
 *
 * ## Waarom een bron een object is en geen functie
 *
 * Tot fase 3 haalde de agent zijn feiten op met drie vaste functies die
 * rechtstreeks tegen de demo-tabellen praatten. Dat werkte, maar het betekende
 * dat élke specialist dezelfde feiten kreeg — ook de AVG-specialist, die
 * ordergegevens juist niet hoort te zien — en dat een tweede module geen feiten
 * kon ophalen zonder een kernbestand te bewerken.
 *
 * Een bron als object lost allebei op: de kern kan hem filteren op de
 * `toolScope` van de gekozen specialist zonder te weten wát hij ophaalt, en de
 * module bepaalt zelf waar zijn gegevens vandaan komen.
 */

/** Een tool op een MCP. De env-sleutel, niet de URL: die staat in de secrets. */
export interface FactSourceMcp {
  kind: 'mcp';
  /** De env-sleutel van de MCP, bv. `FACTUMAI_MCP_ERP_URL`. */
  mcp: string;
  /** De tool op die MCP. */
  tool: string;
}

/**
 * Een tabel in de klant-database.
 *
 * Bestaat omdat niet elke klant al een MCP heeft voor elk bronsysteem. De
 * demo-tabellen zijn er het voorbeeld van: die dragen vandaag de hele
 * feitenlaag. Wisselt een klant over op een echte MCP, dan verandert alleen dit
 * veld — de rest van de bron blijft staan.
 */
export interface FactSourceTable {
  kind: 'table';
  table: string;
}

export type FactSource = FactSourceMcp | FactSourceTable;

/** Wat een bron mag weten om te bepalen of en waarmee hij moet ophalen. */
export interface FactContext {
  /** Het signaal zoals de kern het leest. */
  envelope: SignalEnvelope;
  /** Wat de classifier eruit haalde, bv. `{ orderNumber: 'ORD-1' }`. */
  extracted: Record<string, unknown>;
  /** Wat de resolve-stap opleverde, bv. een contact-id. */
  resolved: Record<string, unknown>;
  /**
   * Wat de eerdere bronnen van deze run opleverden, op naam.
   *
   * Hiermee kan een bron op een andere leunen: de tracking hangt aan de code
   * die uit de order kwam. De bronnen draaien in de volgorde waarin ze op het
   * pakket staan, dus een bron ziet alleen wat vóór hem stond.
   */
  results: Readonly<Record<string, unknown>>;
}

/** Eén geverifieerd feit, klaar om aan het model te geven. */
export interface FactDraft {
  /**
   * De id waarmee het model dit feit citeert. Wordt de `toolCallId` in de
   * grounding, dus stabiel houden: een claim verwijst hiernaar.
   */
  id: string;
  text: string;
}

export interface FactProvider {
  /** De naam waarmee een specialist deze bron in zijn `toolScope` noemt. */
  name: string;
  /** Eén regel: wat haalt dit op, en wanneer heeft het zin. */
  description: string;
  source: FactSource;
  /**
   * De datacategorieën die deze bron mag teruggeven. Gaat mee op de call: laat
   * je ze weg, dan krijg je alleen `operationeel` terug en verdwijnen velden
   * stilzwijgend (`docs/RECHTEN.md`). Wat de agent zelf niet mag, valt er
   * alsnog af — een bron kan zijn eigen grens niet oprekken.
   */
  dataCategories: readonly DataCategory[];
  /**
   * De invoer voor deze bron, of `null` als hij niet van toepassing is op dit
   * signaal.
   *
   * `null` is de normale uitkomst en geen fout: een ordervraag zonder
   * ordernummer heeft niets op te halen. Een bron die dan tóch iets ophaalt,
   * levert feiten over de verkeerde zaak.
   */
  input(ctx: FactContext): Record<string, unknown> | null;
  /**
   * Zet de respons om in nul of meer feiten. **Puur en zonder model**: wat hier
   * uitkomt is precies wat het model als waarheid krijgt, en het mag dus niet
   * zelf al een interpretatie zijn.
   *
   * Nul feiten mag: een geslaagde lookup die niets vond, is geen feit.
   */
  toFacts(data: unknown, ctx: FactContext): FactDraft[];
}

/**
 * Wanneer iets in dit domein automatisch mag, en wanneer een mens ertussen
 * moet.
 *
 * Twee velden, en dat is met opzet het minimum: dit is alles wat de kern
 * vandaag écht uitleest. De degradatie zelf (`finalizeOutcome`), de routering
 * per uitkomst (`OUTCOME_ROUTING`) en de kanaalregel dat mail nooit zonder mens
 * gaat, zijn generiek en blijven in `outcomes/`.
 */
export interface OutcomePolicy {
  /**
   * Wat "geïdentificeerd" betekent, per kanaal.
   *
   * Per module en niet globaal, omdat de inzet verschilt: bij een klantvraag
   * over de eigen order volstaat het afzenderadres, bij een boeking op een
   * crediteurenrekening niet. Een kanaal dat hier ontbreekt krijgt de strengste
   * variant — nooit stilzwijgend soepeler worden.
   */
  identification: Readonly<Partial<Record<ChannelId, IdentificationPolicy>>>;
  /**
   * De uitkomst als de router er zelf geen noemt (oude prompt, kapotte JSON).
   *
   * Een functie en geen tabel: bij klantenservice hangt `systeem` ervan af of
   * er een ordernummer in het bericht stond, en dat is per domein een ander
   * soort vraag. Conservatief invullen — alles waar een mens iets mee moet,
   * hoort `taak` te zijn.
   */
  fallbackOutcome(input: {
    specialist?: SpecialistId;
    extracted?: Record<string, unknown>;
  }): Outcome;
  /**
   * Het adres dat een bronsysteem bij dit signaal bevestigde, uit de opgehaalde
   * feiten.
   *
   * Dat adres is het verschil tussen "iemand noemt een nummer" en "de bron
   * knoopt dit adres aan deze zaak", en daarmee tussen wel en geen
   * schrijfactie. Wélk veld van wélke bron dat is, weet alleen de module: bij
   * klantenservice is het `customer_email` op de order, bij administratie het
   * adres van de crediteur.
   *
   * Weglaten mag; dan blijft de identificatie op wat het bericht zelf zegt.
   */
  sourceEmail?(results: Readonly<Record<string, unknown>>): string | null;
}

/**
 * Wat deze module in de werkbak neerlegt.
 *
 * Alleen `defaultKind`. De vormen die de module produceert (`kinds`) staan al
 * op de descriptor, want dáár leest de cockpit ze om historie zonder
 * `module`-kolom alsnog in de juiste tab te krijgen. Ze hier herhalen levert
 * twee lijsten op die uit elkaar kunnen lopen.
 */
export interface ReviewPolicy {
  /**
   * De vorm die een voorstel krijgt als de plan-stap er geen noemt.
   *
   * Bestaat omdat `'draft_email'` op vier plekken in de kern als default stond.
   * Een module die facturen produceert hoort daar geen concept-mail uit te
   * krijgen.
   */
  defaultKind: ReviewItemKind;
}

/**
 * Welk geheugen dit domein raadpleegt.
 *
 * De scopes staan al per specialist (`IntentConfig.memoryScope`); wat hier
 * staat is de grens van het proces als geheel. `processTags` begrenst welke
 * PROCESS-memories van deze module zijn — zonder die grens haalt de ene
 * afdeling straks de SOP's van de andere op, en dat valt niet op omdat het
 * antwoord er plausibel uitziet.
 */
export interface MemoryPolicy {
  /** De procestags die bij dit domein horen. Leeg = geen PROCESS-geheugen. */
  processTags: readonly string[];
}

/**
 * Alles wat één automatisering aan de kern levert.
 *
 * Toevoegen aan dit contract is duur: elke module moet het invullen, ook die
 * van een klant. Vraag eerst of het niet op de module zelf kan blijven.
 */
export interface ModulePack {
  /** Wat de module over zichzelf verklaart aan de schil: id, label, kinds. */
  descriptor: ModuleDescriptor;

  /** Welke signalen deze module claimt. Bepaalt de routering. */
  claims: readonly SignalClaim[];

  /** Waar deze module wel en niet over gaat. Per module een eigen poort. */
  gate: DomainConfig;

  /** slug, label, specialist, afbakening. Voedt de classify-prompt. */
  taxonomy: readonly CategoryDef[];

  /** De specialisten van dit domein. Geen globale `CORE_INTENTS` meer. */
  specialists: readonly IntentConfig[];

  /**
   * Feitenbronnen, in de volgorde waarin ze draaien. Leeg mag — dan krijgt het
   * model geen geverifieerde feiten en kan het dus ook geen cijfers noemen.
   */
  facts: readonly FactProvider[];

  /** De schrijfoperaties die dit domein mag voorstellen. */
  actions: readonly ActionTypeDef[];

  /** Identificatie-eisen en uitkomstroutering van dit domein. */
  outcomes: OutcomePolicy;

  /** Welke vorm een voorstel krijgt. */
  review: ReviewPolicy;

  /** Welk geheugen dit domein raadpleegt. */
  memory: MemoryPolicy;

  /**
   * Waar dit domein zijn signalen vandaan haalt naast mail en chat: geplande
   * automatiseringen en polls.
   *
   * Optioneel, want een module die alleen op binnenkomende berichten werkt
   * heeft ze niet. Zodra een domein begint bij een openstaande post of een
   * voorraadstand, staat het hier — en niet in de cron, die alleen leest wie er
   * aan de beurt is.
   */
  triggers?: ModuleTriggers;

  /**
   * Modeloverride per tier. Weglaten = de tenant-brede keuze uit config.
   *
   * Bedoeld voor een domein dat aantoonbaar zwaarder of lichter is dan de rest,
   * niet om per module aan de knoppen te draaien. Model-IDs komen uit config,
   * nooit uit code (harde regel 7).
   */
  models?: Partial<ModelConfig>;
}

/**
 * Matcht één claim tegen een signaal.
 *
 * Losstaand en geëxporteerd zodat de registry en de tests dezelfde regel
 * gebruiken: een claim zonder `type` pakt het hele domein, met `type` alleen
 * dat type, en `when` mag daarbovenop nog weigeren.
 */
export function claimMatches(claim: SignalClaim, signal: Signal): boolean {
  if (claim.domain !== signal.domain) return false;
  if (claim.type !== undefined && claim.type !== signal.type) return false;
  return claim.when ? claim.when(signal) : true;
}
