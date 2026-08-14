import type { IntentConfig } from './types.js';

/**
 * missing_parts — klant meldt ontbrekende onderdelen uit een eerdere levering.
 *
 * Frequente Sunwise-flow: "ik mis moertjes / bevestigingsmateriaal /
 * een klein onderdeel". Vereist woo.get_order om te zien wat er
 * oorspronkelijk besteld was (line-items + SKU's), dan een nazending
 * voorstellen. Nazending = losse order zonder betaling
 * (`woo.create_order` met totaal €0). Verzendlabel via mcp-shipping.
 *
 * Volgens jullie architectuur-keuze: **WooCommerce is de bron van
 * waarheid** voor missing-parts — BC blijft buiten deze intent-scope.
 * Als een edge-case BC-check nodig heeft ("moertjes op backorder?"),
 * dan flagt de plan-stap `needs_bc_check` en escaleert naar review.
 */
export const missingPartsConfig: IntentConfig = {
  id: 'missing_parts',
  displayName: 'Ontbrekende onderdelen',
  description:
    'Klant meldt ontbrekende onderdelen uit een eerdere levering ' +
    '(moertjes, bevestigingsmateriaal, klein onderdeel). Doel: ' +
    'nazending als losse order zonder betaling.',
  systemPrompt: [
    'Je beantwoordt een melding over ONTBREKENDE ONDERDELEN uit een',
    'eerdere Sunwise-levering.',
    'Werkwijze:',
    '1. Resolve de oorspronkelijke order in WooCommerce (woo.get_order).',
    '2. Verifieer dat de gemelde onderdelen ook echt in de line-items',
    '   stonden. Als niet — flag het als "niet in originele bestelling"',
    '   en vraag om verduidelijking.',
    '3. Als wél in originele bestelling — stel nazending voor als losse',
    '   order zonder betaling. Vermeld verwachte verzendtermijn.',
    '4. Bij twijfel over voorraad of backorder → escaleer naar review',
    '   met flag `needs_bc_check`.',
    'Toon: excuses erkennen (kort), oplossingsgericht, praktisch. Nederlands.',
    'Nooit autonoom een nazending inboeken zonder menselijke controle.',
  ].join('\n'),
  toolScope: [
    'erp.get_order', // WooCommerce als ERP-vendor voor Sunwise
    'shipping.get_tracking',
    // Toekomst: 'erp.create_order' voor nazending, 'shipping.create_label'
  ],
  memoryScope: ['GLOBAL', 'CLIENT', 'PROCESS'],
  memoryProcessTag: 'missing_parts',
  modelTierHint: 'plan',
  confidenceThreshold: 0.85,
  needsHitl: true,
};
