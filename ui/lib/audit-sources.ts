/**
 * Registry van domein-auditbronnen.
 *
 * De kern-auditlog toont mail-beslissingen (`aios_review_items`). Een klant met
 * een eigen domeinmodule wil z'n eigen events op diezelfde tijdlijn zien — een
 * magazijn-werkticket dat is opgepakt, een CRM-record dat is bijgewerkt.
 * Zo'n module registreert zich hier; de auditpagina, de bron-filter en de
 * CSV-export pakken 'm automatisch mee.
 *
 * Leeg in het fundament: een verse klant heeft alleen mail-events.
 * Werkend voorbeeld: `examples/warehouse-module/ui/lib/warehouse-audit.ts`.
 */

import { moduleAuditSources } from "./modules";
import type { AuditEntry, AuditQuery } from "./db";
import type { CockpitDbClient } from "./tenant-query";

export interface DomainAuditSource {
  /** Slug in `AuditEntry.source` en in de bron-dropdown (bv. "warehouse"). */
  id: string;
  /** Label in de bron-dropdown en de CSV-kolom (bv. "Magazijn"). */
  label: string;
  /**
   * Acties die deze bron kan produceren (bv. ["CLAIMED", "SHIPPED"]). Wordt
   * gebruikt om de bron over te slaan zodra er op een status wordt gefilterd
   * die deze bron per definitie niet kan opleveren.
   */
  actions: string[];
  /**
   * Mensvriendelijke labels per actie, voor de actie-dropdown en de CSV.
   * Ontbreekt een actie hier, dan toont de UI de ruwe slug.
   */
  actionLabels?: Record<string, string>;
  /** Haalt de events op, al gefilterd op datum/actor voor zover mogelijk. */
  fetch(
    client: CockpitDbClient,
    query: AuditQuery,
    cap: number,
  ): Promise<AuditEntry[]>;
  /** Optioneel: actor-adressen voor de "door"-dropdown op de auditpagina. */
  actors?(client: CockpitDbClient): Promise<string[]>;
  /**
   * Optioneel: waar de "bekijk record"-link van dit event heen wijst
   * (bv. `/magazijn?focus=<id>`). Geen href = geen extra link.
   */
  linkHref?(entry: AuditEntry): string | null;
}

/**
 * Klantspecifieke auditbronnen — bronnen die niet bij een module horen maar bij
 * één klant. Aanhaken:
 *
 *   import { warehouseAuditSource } from "./warehouse-audit";
 *   export const CLIENT_AUDIT_SOURCES: DomainAuditSource[] = [warehouseAuditSource];
 *
 * Hoort de bron bij een automatisering, zet 'm dan op de module (`auditSource`)
 * in plaats van hier — dan verhuist hij mee als die module verhuist.
 */
export const CLIENT_AUDIT_SOURCES: DomainAuditSource[] = [];

/**
 * Alle auditbronnen: die van de geregistreerde modules, plus de klantspecifieke
 * hierboven.
 *
 * **Een functie en geen const.** De modules importeren de database-laag, en die
 * importeert dit bestand — een const zou tijdens die cyclus als `undefined`
 * kunnen landen bij de eerste lezer. Lui uitrekenen breekt dat: op het moment
 * dat iemand dit áánroept, is alles geladen.
 *
 * Modules eerst: een klant die een bron met dezelfde id registreert, wint
 * daarmee niet stilzwijgend van zijn eigen module — dubbele id's horen op te
 * vallen in de bron-dropdown, niet weggefilterd te worden.
 */
export function domainAuditSources(): DomainAuditSource[] {
  return [...moduleAuditSources(), ...CLIENT_AUDIT_SOURCES];
}

/** Alle acties die door domeinbronnen geproduceerd kunnen worden. */
export function domainAuditActions(): string[] {
  return [...new Set(domainAuditSources().flatMap((s) => s.actions))];
}

/** Bronnen die passen bij de gevraagde `source`-filter ("all" = allemaal). */
export function selectedDomainSources(source: string): DomainAuditSource[] {
  const all = domainAuditSources();
  if (source === "all") return all;
  return all.filter((s) => s.id === source);
}
