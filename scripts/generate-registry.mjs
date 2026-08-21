#!/usr/bin/env node
/**
 * Schrijft de twee moduleregisters uit `client.manifest.yaml`.
 *
 *   pnpm modules:generate          schrijft de bestanden
 *   pnpm modules:generate --check  faalt als ze niet kloppen (CI)
 *
 * ## Waarom gegenereerd
 *
 * `ui/lib/modules/registry.ts` en `agents/mail-agent/src/domain/index.ts` waren
 * de twee bestanden die élke klant aanpast, en dus de twee bestanden waarop élke
 * fundament-update semantisch botst — zonder dat git een conflict meldt, want de
 * regels eromheen zijn gelijk gebleven. Met tien klantrepo's is dat een tijdbom.
 *
 * Gegenereerd betekent: een merge-conflict in een register los je op door dit
 * script opnieuw te draaien, niet met de hand. Het manifest is de bron; deze
 * bestanden zijn een projectie.
 *
 * ## De naamafspraak
 *
 * Een module met id `inkoop` levert:
 *
 *   packages/agent-core/src/modules/inkoop/pack.ts   → export const inkoopPack
 *   ui/lib/modules/inkoop.ts                         → export const inkoopModule
 *
 * Met `source: client` staan ze in `client-modules/` in plaats van `modules/`.
 * Die mappen raakt het fundament nooit aan.
 *
 * ## De parser
 *
 * Bewust geen YAML-afhankelijkheid voor één blok. Dit leest `modules:` en de
 * velden eronder, en niets anders — net als `check-module-guards.mjs` is dit een
 * grep met een mening. Klopt het blok niet, dan faalt het script luid in plaats
 * van een half register te schrijven.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const MANIFEST = "client.manifest.yaml";
const CORE_OUT = "packages/agent-core/src/modules/registry.generated.ts";
const UI_OUT = "ui/lib/modules/registry.generated.ts";

const check = process.argv.includes("--check");

/**
 * Leest het `modules:`-blok: een lijst van `- id: "..."` met `source:` en
 * `order:` eronder. Commentaarregels en lege regels worden overgeslagen; het
 * blok eindigt bij de eerste regel die weer in de eerste kolom begint.
 */
function leesModules(bron) {
  const regels = bron.split("\n");
  const start = regels.findIndex((r) => r.trimEnd() === "modules:");
  if (start === -1) throw new Error(`${MANIFEST} heeft geen modules:-blok`);

  const modules = [];
  for (let i = start + 1; i < regels.length; i++) {
    const regel = regels[i];
    if (regel.trim() === "" || regel.trim().startsWith("#")) continue;
    if (!/^\s/.test(regel)) break; // terug in de eerste kolom: blok is klaar

    const item = regel.match(/^\s*-\s*id:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/);
    if (item) {
      modules.push({ id: item[1], source: "core", order: modules.length * 10 });
      continue;
    }
    if (modules.length === 0) continue;
    const huidig = modules[modules.length - 1];
    const source = regel.match(/^\s*source:\s*["']?(core|client)["']?\s*$/);
    if (source) huidig.source = source[1];
    const order = regel.match(/^\s*order:\s*(-?\d+)\s*$/);
    if (order) huidig.order = Number.parseInt(order[1], 10);
  }

  if (modules.length === 0) {
    throw new Error(`${MANIFEST}: het modules:-blok is leeg`);
  }
  return modules.sort((a, b) => a.order - b.order);
}

/** `mijn-module` → `mijnModule`, zodat de export-naam voorspelbaar is. */
function camel(id) {
  return id.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
}

const KOP = (bron) =>
  `// GEGENEREERD door scripts/generate-registry.mjs uit ${bron}.\n` +
  `// Niet met de hand bewerken: draai \`pnpm modules:generate\`.\n` +
  `//\n` +
  `// Een merge-conflict in dit bestand los je op door het script opnieuw te\n` +
  `// draaien, niet door de regels te schikken.\n`;

function coreRegistry(modules) {
  const imports = modules
    .map((m) => {
      const map = m.source === "client" ? "../client-modules" : ".";
      return `import { ${camel(m.id)}Pack } from "${map}/${m.id}/pack.js";`;
    })
    .join("\n");
  const lijst = modules.map((m) => `  ${camel(m.id)}Pack,`).join("\n");
  return (
    `${KOP(MANIFEST)}\n` +
    `import type { ModulePack } from "./contract.js";\n` +
    `${imports}\n\n` +
    `/** De modules die deze klant draait, in manifest-volgorde. */\n` +
    `export const MODULE_PACKS: readonly ModulePack[] = Object.freeze([\n` +
    `${lijst}\n` +
    `]);\n`
  );
}

function uiRegistry(modules) {
  const imports = modules
    .map((m) => {
      const map = m.source === "client" ? "../client-modules" : ".";
      return `import { ${camel(m.id)}Module } from "${map}/${m.id}";`;
    })
    .join("\n");
  const lijst = modules.map((m) => `  ${camel(m.id)}Module,`).join("\n");
  return (
    `${KOP(MANIFEST)}\n` +
    `import type { WorkbenchModule } from "./contract";\n` +
    `${imports}\n\n` +
    `/** De modules die deze klant draait, in tabvolgorde uit het manifest. */\n` +
    `export const GENERATED_MODULES: readonly WorkbenchModule[] = Object.freeze([\n` +
    `${lijst}\n` +
    `]);\n`
  );
}

function schrijf(pad, inhoud) {
  const bestaand = existsSync(pad) ? readFileSync(pad, "utf8") : null;
  if (bestaand === inhoud) return "gelijk";
  if (check) return "verschilt";
  writeFileSync(pad, inhoud, "utf8");
  return bestaand === null ? "aangemaakt" : "bijgewerkt";
}

const modules = leesModules(readFileSync(MANIFEST, "utf8"));
const uitkomsten = [
  [CORE_OUT, schrijf(CORE_OUT, coreRegistry(modules))],
  [UI_OUT, schrijf(UI_OUT, uiRegistry(modules))],
];

const scheef = uitkomsten.filter(([, staat]) => staat === "verschilt");
if (scheef.length > 0) {
  console.error(
    `✗ de moduleregisters lopen niet gelijk met ${MANIFEST}:\n` +
      scheef.map(([pad]) => `    ${pad}`).join("\n") +
      `\n\n  Draai \`pnpm modules:generate\` en commit het resultaat.\n`,
  );
  process.exit(1);
}

const beschrijving = modules
  .map((m) => `${m.id}${m.source === "client" ? " (klant)" : ""}`)
  .join(", ");
if (check) {
  console.log(`✓ de moduleregisters lopen gelijk met ${MANIFEST} (${beschrijving})`);
} else {
  for (const [pad, staat] of uitkomsten) console.log(`  ${staat}: ${pad}`);
  console.log(`✓ ${modules.length} module(s): ${beschrijving}`);
}
