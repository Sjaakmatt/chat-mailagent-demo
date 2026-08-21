// GEGENEREERD door scripts/generate-registry.mjs uit client.manifest.yaml.
// Niet met de hand bewerken: draai `pnpm modules:generate`.
//
// Een merge-conflict in dit bestand los je op door het script opnieuw te
// draaien, niet door de regels te schikken.

import type { WorkbenchModule } from "./contract";
import { klantenserviceModule } from "./klantenservice";

/** De modules die deze klant draait, in tabvolgorde uit het manifest. */
export const GENERATED_MODULES: readonly WorkbenchModule[] = Object.freeze([
  klantenserviceModule,
]);
