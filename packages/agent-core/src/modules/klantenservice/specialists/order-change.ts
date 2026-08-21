import type { IntentConfig } from '../../../specialists/index.js';

/**
 * order_change — wijzigingsverzoek op een bestaande bestelling.
 *
 * Klant wil een bestelling wijzigen: annuleren, uitbreiden, adres aanpassen,
 * combineren met andere order. Vereist meer redenering dan simple_reply:
 * "kan het nog?" — hangt af van interne workflow-status in BC (Draft/Open
 * mag wijzigen; Released/Invoiced niet zonder overleg), en van
 * productie-planning. Woo levert de klant/webshop-kant, BC de interne
 * status. Het antwoord moet feasibility EXPLICIET benoemen ("ja, kan tot
 * morgen 12:00" of "helaas niet meer omdat...").
 *
 * Model-tier: Sonnet — dit is redeneerwerk. Nooit auto-approven zonder
 * mens; wijzigingen die BC raken zijn onomkeerbaar-ish.
 */
export const orderChangeConfig: IntentConfig = {
  id: 'order_change',
  displayName: 'Order wijzigen',
  description:
    'Klant vraagt om aanpassing van een bestaande bestelling: annuleren, ' +
    'uitbreiden, adres wijzigen, samenvoegen. Vereist feasibility-check ' +
    'tegen BC-status en productie-planning.',
  systemPrompt: [
    'Je beantwoordt een wijzigingsverzoek op een bestaande order van {{client}}.',
    'Werkwijze:',
    '1. Resolve de order via de tools (bevestig de identificatie expliciet',
    '   in je antwoord).',
    '2. Check de INTERNE status in BC (bc.get_order). Draft/Open/Pending →',
    '   wijziging kan waarschijnlijk. Released/Shipped/Invoiced → wijziging',
    '   vereist overleg met productie/logistiek.',
    '3. Formuleer een concreet antwoord met feasibility: "ja, kan tot X"',
    '   of "helaas niet meer omdat Y" — nooit vaag.',
    '4. Voorstellen tot backend-mutatie (bc.update_order) mogen genoemd,',
    '   maar de daadwerkelijke mutatie gebeurt PAS na goedkeuring in de',
    '   cockpit — nooit autonoom.',
    'Toon: zakelijk-behulpzaam, meelevend zonder overdrijven. Nederlands.',
  ].join('\n'),
  toolScope: [
    'erp.get_order', // WooCommerce voor klant-perspectief
    'bc.get_order', // via mcp-erp met microsoft-bc adapter — interne status
    'shipping.get_tracking',
  ],
  memoryScope: ['GLOBAL', 'CLIENT', 'PROCESS'],
  memoryProcessTag: 'order_change',
  modelTierHint: 'plan',
  confidenceThreshold: 0.85,
  needsHitl: true,
};
