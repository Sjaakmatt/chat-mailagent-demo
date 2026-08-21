/**
 * Welke module een signaal behandelt — de rand waar de kern het pakket krijgt.
 *
 * De lus-kern kent geen enkele module bij naam: `orchestrate()` en
 * `runSpecialize()` krijgen het pakket als input. Hier wordt het opgezocht, en
 * hier wordt ook beslist wat er gebeurt als niemand het signaal claimt.
 *
 * Dat laatste is met opzet een **expliciet** geval en geen terugval op
 * klantenservice. Een bankmutatie die per ongeluk in de wachtrij belandt, hoort
 * niet door de poort van de klantenservice te gaan: die wijst 'm af als buiten
 * domein, en dan staat er een net geformuleerd "daar ga ik niet over" op iets
 * waar wel degelijk iemand naar had moeten kijken.
 */

import {
  packForActionType,
  resolveModule,
  type ModulePack,
  type Signal,
} from '@factumai/agent-core';

export { resolveModule };

/**
 * Het pakket voor dit signaal, of een fout.
 *
 * Voor plekken **na** de router: daar is al vastgesteld dat een module het
 * signaal claimt, dus geen match is een bug en geen scenario. Gooien is dan het
 * juiste gedrag — een Workflow die faalt is zichtbaar, een Workflow die stil
 * het verkeerde pakket pakt niet.
 */
export function requirePack(signal: Signal): ModulePack {
  const pack = resolveModule(signal);
  if (!pack) {
    throw new Error(
      `geen module claimt signaal ${signal.id} (${signal.domain}/${signal.type}). ` +
        `Voeg een claim toe aan een modulepakket of zet de module in het ` +
        `modules:-blok van client.manifest.yaml.`,
    );
  }
  return pack;
}

/**
 * Het pakket dat dit actietype bezit, of een fout.
 *
 * Een opgeslagen voorstel draagt alleen de slug van zijn actietype. Bestaat dat
 * type niet meer, dan is uitvoeren precies wat je niet wilt: dan schrijven we
 * iets waarvan niemand meer heeft vastgelegd wat het doet.
 */
export function requirePackForAction(slug: string): ModulePack {
  const pack = packForActionType(slug);
  if (!pack) {
    throw new Error(
      `actietype "${slug}" hoort bij geen enkele geregistreerde module — niets uitgevoerd`,
    );
  }
  return pack;
}
