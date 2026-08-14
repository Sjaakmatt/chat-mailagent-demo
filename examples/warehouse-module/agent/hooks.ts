/**
 * VOORBEELD — magazijn-module: de `afterExecute`-hook.
 *
 * Dit is de code die in de Sunwise-agent hard in `workflows/execute.ts` stond
 * en in het fundament naar een domeinmodule is verplaatst. Zo ziet een
 * klant-eigen side effect eruit die op de kern-lus aanhaakt.
 *
 * Installeren in een klant-agent:
 *   1. Kopieer `agent/` naar `agents/mail-agent/src/warehouse/`.
 *   2. Kopieer de migraties uit `migrations/` naar de repo-`migrations/`
 *      (hernummer op de volgende vrije index).
 *   3. Registreer de hook in `agents/mail-agent/src/domain/index.ts`:
 *
 *        import { warehouseHooks } from '../warehouse/hooks.js';
 *        export const DOMAIN_HOOKS: DomainHooks[] = [warehouseHooks];
 *
 *   4. Kopieer de UI-pagina's uit `ui/` en voeg de nav-items toe aan
 *      `ui/lib/brand.ts` → `extraNavItems`.
 */

import type { DomainHooks, DomainHookContext } from '../../../agents/mail-agent/src/domain/index.js';
import {
  createShipmentTask,
  loadOrderForShipment,
  type OrderShipmentInfo,
} from './store-shipments.js';

/** Deterministisch nep-verzendlabel (stabiel over retries). */
function makeFakeLabel(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `3SDEMO${h.toString().padStart(10, '0').slice(0, 10)}`;
}

/**
 * Maakt het toegepaste beleid een verzending? Dan een idempotente verzendtaak
 * met nep-label (demo). Echte verzending volgt via een mcp-shipping; de
 * taak-tabel blijft de bron voor de magazijn-werkbak.
 *
 * Idempotent via `id = ship-<reviewItemId>` + merge-duplicates, zodat een
 * herhaalde Workflow-step geen tweede werkticket oplevert.
 */
async function afterExecute({ env, item }: DomainHookContext): Promise<void> {
  const proposed = item.proposed as {
    policy?: { ruleId?: string; createsTask?: boolean };
    classification?: { extracted?: { orderNumber?: string } };
    resolved?: { enrichment?: { toEmail?: string } };
    original?: { from?: string };
  };
  if (!proposed.policy?.createsTask) return;

  const orderRef = proposed.classification?.extracted?.orderNumber ?? null;
  // Verrijk het werkticket met klant/adres/SKU's uit de order zodat het
  // magazijn weet wát te picken.
  let info: OrderShipmentInfo = {};
  if (orderRef) {
    try {
      info = await loadOrderForShipment(env, orderRef);
    } catch {
      info = {};
    }
  }
  await createShipmentTask(env, {
    id: `ship-${item.id}`,
    organizationId: item.organizationId,
    reviewItemId: item.id,
    signalId: item.signalId ?? null,
    customerEmail:
      info.customerEmail ??
      proposed.resolved?.enrichment?.toEmail ??
      proposed.original?.from ??
      null,
    customerName: info.customerName ?? null,
    customerAddress: info.customerAddress ?? null,
    items: info.items ?? null,
    orderReference: orderRef,
    description: item.summary,
    label: makeFakeLabel(item.id),
    triggeredByRuleId: proposed.policy.ruleId ?? null,
  });
}

export const warehouseHooks: DomainHooks = { afterExecute };
