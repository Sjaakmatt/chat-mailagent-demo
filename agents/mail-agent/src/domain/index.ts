/**
 * Domein-extensiepunt — de enige plek waar klant-specifieke side effects de
 * kern-lus in mogen haken.
 *
 * De kern kent één side effect: het uitvoeren van de goedgekeurde actie op het
 * ReviewItem (mail versturen/labelen). Alles wat een specifieke klant daar
 * bovenop doet — een magazijn-werkticket, een CRM-update, een ticket in een
 * extern systeem — hoort hier, niet in `workflows/execute.ts`.
 *
 * Standaard is dit een no-op: een verse klant-agent heeft geen domeinmodule en
 * gedraagt zich als pure mail → review → verzenden.
 *
 * Aanhaken bij een nieuwe klant:
 *   1. Schrijf een module met een `afterExecute`-functie.
 *   2. Zet 'm in `DOMAIN_HOOKS` hieronder.
 *   3. Voeg de bijbehorende migratie toe in `migrations/`.
 *
 * Werkende referentie-implementatie: `examples/warehouse-module/`.
 */

import type { ReviewItem } from '@factumai/agent-core';
import type { Env } from '../env.js';

/**
 * Context die de Execute-Workflow meegeeft aan elke hook. Bewust smal: een
 * hook mag lezen wat er is goedgekeurd, niet de lus herschrijven.
 */
export interface DomainHookContext {
  env: Env;
  /** Het ReviewItem zoals goedgekeurd — status is op dit punt EXECUTED. */
  item: ReviewItem;
}

export interface DomainHooks {
  /**
   * Draait binnen dezelfde durable step als de mail-verzending, ná de
   * geslaagde side effect. Moet **idempotent** zijn: Workflows kunnen een step
   * opnieuw draaien, dus schrijf met een stabiele sleutel
   * (bv. `<module>-<reviewItemId>`) en merge-duplicates.
   *
   * Een fout hier mag de mail-afhandeling nooit terugdraaien — de Workflow
   * vangt 'm af en logt 'm (fail-soft, zie CLAUDE.md).
   */
  afterExecute?(ctx: DomainHookContext): Promise<void>;
}

/**
 * Actieve domeinmodules voor deze klant. Leeg in het fundament.
 *
 * Voorbeeld met de magazijn-module:
 *   import { warehouseHooks } from './warehouse/index.js';
 *   export const DOMAIN_HOOKS: DomainHooks[] = [warehouseHooks];
 */
export const DOMAIN_HOOKS: DomainHooks[] = [];

/**
 * Draait alle `afterExecute`-hooks fail-soft. Retourneert de fouten die
 * optraden zodat de caller ze kan loggen; gooit zelf nooit.
 */
export async function runAfterExecuteHooks(
  ctx: DomainHookContext,
): Promise<Error[]> {
  const errors: Error[] = [];
  for (const hook of DOMAIN_HOOKS) {
    if (!hook.afterExecute) continue;
    try {
      await hook.afterExecute(ctx);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  return errors;
}
