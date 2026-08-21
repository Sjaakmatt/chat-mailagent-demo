/**
 * Het register van modulepakketten aan de agent-kant.
 *
 * Dit is de **enige** plek in de kern waar een module bij naam voorkomt, en
 * zelfs dat gebeurt indirect: de lijst zelf staat in `registry.generated.ts`,
 * geschreven door `scripts/generate-registry.mjs` uit het `modules:`-blok van
 * `client.manifest.yaml`.
 *
 * Waarom gegenereerd. Vóór fase 1 waren `ui/lib/modules/registry.ts` en
 * `agents/mail-agent/src/domain/index.ts` de bestanden die élke klant aanpaste,
 * en dus de bestanden waarop élke fundament-update semantisch botst zonder dat
 * git een conflict meldt. Met tien klantrepo's is dat een tijdbom. Een conflict
 * in een gegenereerd bestand los je op door het script opnieuw te draaien.
 *
 * Alles hieronder werkt op de lijst en kent geen enkele module bij naam.
 */

import type { ModuleId, Signal } from '../contracts/index.js';
import type { ActionTypeDef } from '../actions/index.js';
import { claimMatches, type ModulePack } from './contract.js';
import { MODULE_PACKS } from './registry.generated.js';

export { MODULE_PACKS };

/**
 * Het pakket met dit id, of null als het niet geregistreerd is.
 *
 * Null en geen terugval: een voorstel uit een module die hier niet (meer)
 * draait, hoort zichtbaar te zijn in plaats van bij de eerste de beste module
 * te belanden.
 */
export function packById(id: string | null | undefined): ModulePack | null {
  if (!id) return null;
  return MODULE_PACKS.find((p) => p.descriptor.id === id) ?? null;
}

/**
 * Welke module dit signaal behandelt.
 *
 * Matcht op de claims: domein plus type, en desnoods een predicaat. Geen match
 * geeft `null`, en dat is een **expliciet resultaat** — geen stilzwijgende
 * terugval op klantenservice. Een signaal dat niemand claimt hoort te blijven
 * staan met een leesbare reden, niet door de verkeerde poort te gaan.
 *
 * Claimen twee modules hetzelfde signaal, dan wint de eerste in manifest-
 * volgorde. Dat is een bewuste keuze en geen wedstrijd: `assertRegistry`
 * hieronder kan die botsing niet zien (een predicaat is pas bij een echt
 * signaal te beoordelen), dus de volgorde in het manifest is het antwoord.
 * Zet de specifiekste module bovenaan.
 */
export function resolveModule(signal: Signal): ModulePack | null {
  return (
    MODULE_PACKS.find((pack) =>
      pack.claims.some((claim) => claimMatches(claim, signal)),
    ) ?? null
  );
}

/** De descriptors van alle geregistreerde modules — voor de schil-lookups. */
export function moduleDescriptors() {
  return MODULE_PACKS.map((p) => p.descriptor);
}

/**
 * Het actietype bij deze slug, over alle geregistreerde modules heen.
 *
 * Over alle modules en niet binnen één, omdat `aios_proposed_actions.type`
 * alleen de slug draagt: bij het goedkeuren van een opgeslagen voorstel is er
 * geen module om mee te zoeken. Daarom eist `assertRegistry` dat slugs uniek
 * zijn — zonder die eis zou dezelfde slug in twee processen niet uit elkaar te
 * houden zijn, en dan keurt iemand de verkeerde operatie goed.
 */
export function actionTypeBySlug(slug: string): ActionTypeDef | null {
  return packForActionType(slug)?.actions.find((a) => a.slug === slug) ?? null;
}

/**
 * De module die dit actietype bezit.
 *
 * Nodig waar een opgeslagen voorstel wordt uitgevoerd: dat draagt alleen de
 * slug, en het vervolg (een ticket, een nummerreeks) hoort bij het proces
 * waar de actie uit komt.
 */
export function packForActionType(slug: string): ModulePack | null {
  return MODULE_PACKS.find((p) => p.actions.some((a) => a.slug === slug)) ?? null;
}

/**
 * Controleert de registry op fouten die pas in productie zouden opvallen.
 *
 * Draait in de tests en in `scripts/generate-registry.mjs` — niet bij het
 * importeren. Een kern die bij het laden gooit, neemt de hele Worker mee, en
 * dan is een dubbele slug ineens een storing in plaats van een bouwfout.
 *
 * Geeft de gevonden fouten terug; leeg is goed.
 */
export function assertRegistry(
  packs: readonly ModulePack[] = MODULE_PACKS,
): string[] {
  const fouten: string[] = [];

  const gezien = new Set<ModuleId>();
  for (const pack of packs) {
    const id = pack.descriptor.id;
    if (gezien.has(id)) fouten.push(`module "${id}" staat twee keer in de registry`);
    gezien.add(id);
  }

  const slugEigenaar = new Map<string, ModuleId>();
  for (const pack of packs) {
    for (const actie of pack.actions) {
      const eerder = slugEigenaar.get(actie.slug);
      if (eerder !== undefined) {
        fouten.push(
          `actietype "${actie.slug}" bestaat in zowel "${eerder}" als ` +
            `"${pack.descriptor.id}". Slugs zijn uniek over modules heen, want ` +
            `een opgeslagen voorstel draagt alleen de slug.`,
        );
      }
      slugEigenaar.set(actie.slug, pack.descriptor.id);
    }
  }

  for (const pack of packs) {
    if (pack.specialists.length === 0) {
      fouten.push(`module "${pack.descriptor.id}" heeft geen specialisten`);
    }
    if (pack.taxonomy.length === 0) {
      fouten.push(`module "${pack.descriptor.id}" heeft geen categorieën`);
    }
    // Een categorie die naar een specialist wijst die deze module niet kent,
    // routeert stilzwijgend naar de escalatie-terugval. Dat is precies het
    // soort fout dat je pas ziet als een klant belt.
    const ids = new Set(pack.specialists.map((s) => s.id));
    for (const categorie of pack.taxonomy) {
      if (!ids.has(categorie.specialist)) {
        fouten.push(
          `categorie "${categorie.slug}" in "${pack.descriptor.id}" wijst naar ` +
            `specialist "${categorie.specialist}", die deze module niet heeft`,
        );
      }
    }
  }

  return fouten;
}
