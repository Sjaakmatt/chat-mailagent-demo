// GEGENEREERD door scripts/generate-registry.mjs uit client.manifest.yaml.
// Niet met de hand bewerken: draai `pnpm modules:generate`.
//
// Een merge-conflict in dit bestand los je op door het script opnieuw te
// draaien, niet door de regels te schikken.

import type { ModulePack } from "./contract.js";
import { klantenservicePack } from "./klantenservice/pack.js";

/** De modules die deze klant draait, in manifest-volgorde. */
export const MODULE_PACKS: readonly ModulePack[] = Object.freeze([
  klantenservicePack,
]);
