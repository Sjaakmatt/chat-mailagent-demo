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
 * De routes die bij een module horen.
 *
 * Handmatig, en dat is een bewuste keuze: dit script uit `registry.ts` laten
 * lezen zou TypeScript moeten compileren en de hele database-laag meetrekken.
 * Komt er een module bij, dan komt hier een regel bij — en die regel is precies
 * het moment waarop je nadenkt over de guard.
 */
const MODULE_ROUTES = [
  "tickets",
  "gesprekken",
  "feedback",
  "mail",
];

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
  console.log(`✓ alle module-schermen roepen ${GUARD} aan`);
}
