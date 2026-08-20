#!/usr/bin/env node
/**
 * Bewaakt dat elk scherm van een module ook echt op die module weigert.
 *
 * ## Waarom dit bestaat
 *
 * De werkbak filtert zijn tabs op moduletoegang, maar dat is verbergen. De
 * losse schermen — tickets, gesprekken, feedback, de detailweergaven — waren
 * gewoon bereikbaar door de URL in te tikken, ook voor iemand die de afdeling
 * niet had afgenomen. Dat gold voor vijf pagina's tegelijk, en het viel niemand
 * op omdat er niets was dat het kon zien.
 *
 * Een unittest kan dit niet vangen: de cockpit heeft geen testrunner, en dit is
 * bovendien geen gedrag maar een afwezigheid. Vandaar een grep met een mening.
 *
 * ## Wat het controleert
 *
 * Elke `page.tsx` onder een route die een module claimt (`navItems[].href` of
 * `detailHref`) moet `requireModulePage` aanroepen. Meer niet — of het de
 * júiste module is, is niet mechanisch te zien; daar is de review voor.
 *
 * Bewust géén AST-parse: dit hoort in vijf regels te passen en nooit de reden
 * te zijn dat een build faalt om een reden die niets met rechten te maken heeft.
 * Een vals alarm los je op door de guard te zetten.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = "ui/app/(dashboard)";
const MODULES_DIR = "ui/lib/modules";
const REGISTRY = join(MODULES_DIR, "registry.ts");
const GUARD = "requireModulePage";
/**
 * De áánroep, niet de naam.
 *
 * Zonder het haakje slaagt een pagina die de guard alleen importeert — en dat
 * is precies wat er overblijft als iemand de aanroep weghaalt maar de import
 * laat staan. Getest door de aanroep te slopen: met alleen `GUARD` bleef dit
 * script groen.
 */
const GUARD_CALL = `${GUARD}(`;

/**
 * De routes die bij een module horen, afgeleid uit de moduleregistratie.
 *
 * Dit stond hier eerst met de hand, en dat was de zwakke plek: komt er een
 * module bij, dan moest iemand eraan denken hier een regel toe te voegen — en
 * juist dat vergeten levert een scherm zonder guard op, het geval dat dit
 * script hoort te vangen.
 *
 * Waarom `registry.ts` niet gewoon geïmporteerd wordt: die trekt de
 * module-registraties mee, en die trekken via `collectSources` de database-laag
 * en de Cloudflare-runtime de node-process in. Dat is een zware afhankelijkheid
 * voor wat een grep is. In plaats daarvan lezen we welke bestanden de registry
 * registreert, en vissen uit díe bestanden de paden — één laag diep, want een
 * moduleregistratie noemt zijn eigen schermen en die van niemand anders.
 */
function moduleRouteSegments() {
  const segments = new Set();
  for (const file of registeredModuleFiles()) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      // Alleen regels die over een link gaan: `href: "/tickets"` in navItems en
      // de `detailHref`-definitie. Zo pikken we geen pad op uit bijvoorbeeld een
      // fetch-aanroep die toevallig in hetzelfde bestand staat.
      if (!/href/i.test(line)) continue;
      for (const match of line.matchAll(/["'`]\/([A-Za-z0-9_-]+)/g)) {
        segments.add(match[1]);
      }
    }
  }
  return [...segments].sort();
}

/** De bestanden die `registry.ts` als module importeert. */
function registeredModuleFiles() {
  const bron = readFileSync(REGISTRY, "utf8");
  const files = [];
  for (const match of bron.matchAll(/from\s+["']\.\/([A-Za-z0-9_-]+)["']/g)) {
    // `contract` bevat alleen types en registreert niets.
    if (match[1] === "contract") continue;
    files.push(join(MODULES_DIR, `${match[1]}.ts`));
  }
  return files;
}

function pagesUnder(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...pagesUnder(full));
    } else if (name === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

const MODULE_ROUTES = moduleRouteSegments();

if (MODULE_ROUTES.length === 0) {
  // Geen enkele route gevonden betekent dat de afleiding stuk is, niet dat er
  // niets te bewaken valt. Luid melden: een script dat nul routes controleert
  // is altijd groen en bewaakt niets.
  console.error(`✗ geen module-routes afgeleid uit ${REGISTRY}`);
  process.exitCode = 1;
}

const ontbreekt = [];
for (const route of MODULE_ROUTES) {
  const pages = pagesUnder(join(APP, route));
  if (pages.length === 0) {
    // Route bestaat niet (meer). Luid melden: een stille lijst die naar niets
    // wijst, bewaakt niets en ziet er wel uit alsof hij dat doet.
    console.error(`✗ geen page.tsx gevonden onder ${APP}/${route}`);
    process.exitCode = 1;
    continue;
  }
  for (const page of pages) {
    if (!readFileSync(page, "utf8").includes(GUARD_CALL)) ontbreekt.push(page);
  }
}

if (ontbreekt.length > 0) {
  console.error(
    `\n✗ Deze module-schermen roepen ${GUARD} niet aan. Zonder die guard zijn ze\n` +
      `  bereikbaar door de URL in te tikken, ook zonder die afdeling:\n`,
  );
  for (const p of ontbreekt) console.error(`    ${p}`);
  console.error(
    `\n  Zet bovenaan de pagina, vóór de eerste query:\n` +
      `    await ${GUARD}(<MODULE>.id);\n`,
  );
  process.exitCode = 1;
} else if (process.exitCode !== 1) {
  console.log(
    `✓ alle module-schermen roepen ${GUARD} aan (${MODULE_ROUTES.join(", ")})`,
  );
}
