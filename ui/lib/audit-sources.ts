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
 * Actieve domein-auditbronnen. Aanhaken:
 *
 *   import { warehouseAuditSource } from "./warehouse-audit";
 *   export const DOMAIN_AUDIT_SOURCES: DomainAuditSource[] = [warehouseAuditSource];
 */
export const DOMAIN_AUDIT_SOURCES: DomainAuditSource[] = [];

/** Alle acties die door domeinbronnen geproduceerd kunnen worden. */
export function domainAuditActions(): string[] {
  return [...new Set(DOMAIN_AUDIT_SOURCES.flatMap((s) => s.actions))];
}

/** Bronnen die passen bij de gevraagde `source`-filter ("all" = allemaal). */
export function selectedDomainSources(source: string): DomainAuditSource[] {
  if (source === "all") return DOMAIN_AUDIT_SOURCES;
  return DOMAIN_AUDIT_SOURCES.filter((s) => s.id === source);
}
