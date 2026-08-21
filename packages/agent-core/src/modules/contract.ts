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
 * Leeg toegestaan: fase 3 vult dit en handhaaft dan de `toolScope` van de
 * specialisten. Vandaag staat `toolScope` netjes op elke specialist en wordt
 * hij nergens uitgelezen — de feiten komen uit vaste lookups in de agent. Dat
 * is precies wat hier straks verdwijnt.
 */
export interface FactProvider {
  /** De naam waarmee een specialist deze bron in zijn `toolScope` noemt. */
  name: string;
  /** De env-sleutel van de MCP, bv. `FACTUMAI_MCP_ERP_URL`. */
  mcp: string;
  /** De tool op die MCP. */
  tool: string;
  /**
   * De datacategorieën die deze bron mag teruggeven. Gaat mee op de call: laat
   * je ze weg, dan krijg je alleen `operationeel` terug en verdwijnen velden
   * stilzwijgend (`docs/RECHTEN.md`).
   */
  dataCategories: readonly DataCategory[];
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

  /** Feitenbronnen. Leeg mag: fase 3 vult dit. */
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
