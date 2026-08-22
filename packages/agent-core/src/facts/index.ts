/**
 * De feitenlaag — welke specialist welke feiten krijgt, en waarom precies die.
 *
 * ## Wat hier veranderde
 *
 * `toolScope` stond sinds fase 1 netjes op elke specialist en werd nergens
 * uitgelezen. De feiten kwamen uit drie vaste functies in de agent, die altijd
 * hetzelfde deden ongeacht wie er ging antwoorden. Twee gevolgen: de
 * AVG-specialist kreeg ordergegevens te zien die hij niet nodig had, en een
 * tweede module kon geen feiten ophalen zonder een kernbestand te bewerken.
 *
 * Vanaf nu bepaalt `toolScope` het. Staat een bron niet in de scope van de
 * gekozen specialist, dan wordt hij niet aangeroepen — geen filter achteraf op
 * het antwoord, maar de call gebeurt niet.
 *
 * ## De grens van deze laag
 *
 * Hier staat *welke* bronnen draaien en *wat* er dan gebeurt. **Niet hóé een
 * bron wordt aangeroepen**: dat verschilt per runtime (een Worker met een
 * MCP-client en een Supabase-client, een test met een map van vaste
 * antwoorden), en agent-core is runtime-agnostisch. De aanroeper levert een
 * `FactRunner`.
 *
 * ## Fail-soft, altijd
 *
 * Een bron die niet antwoordt levert geen feit en laat de run doorgaan. Dat is
 * geen slordigheid maar het punt: zonder feit kan het model geen cijfer
 * onderbouwen, en de grounding-laag laat een onderbouwd cijfer dan wegvallen.
 * Het alternatief — de run laten omvallen — levert een mail op die blijft
 * staan, en dat is erger dan een voorstel zonder getallen.
 */

import type {
  FactContext,
  FactDraft,
  FactProvider,
  FactSource,
  ModulePack,
} from '../modules/contract.js';
import type { DataCategory } from '../access/grants.js';
import type { IntentConfig } from '../specialists/index.js';
import type { ToolCallRecorder } from '../grounding/index.js';

/** Het antwoord van een bron. Zelfde vorm als `McpCallResult`, met opzet. */
export interface FactRunResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Voert één bron uit. Geleverd door de runtime.
 *
 * `dataCategories` komt hier al begrensd binnen: de verzamelaar heeft de
 * wens van de bron al doorsneden met wat de agent mag.
 */
export type FactRunner = (call: {
  source: FactSource;
  input: Record<string, unknown>;
  dataCategories: readonly DataCategory[];
  /** Voor logging: welke bron dit was. */
  name: string;
}) => Promise<FactRunResult>;

export interface CollectFactsInput {
  pack: ModulePack;
  /** De gekozen specialist. Zijn `toolScope` bepaalt wat er draait. */
  specialist: Pick<IntentConfig, 'id' | 'toolScope'>;
  ctx: Omit<FactContext, 'results'>;
  run: FactRunner;
  /** Legt elke geslaagde call vast, zodat een claim ernaar kan verwijzen. */
  recorder: Pick<ToolCallRecorder, 'record'>;
  /** Wat de agent zélf mag ophalen. De bovengrens; zie docs/RECHTEN.md. */
  allowedCategories: readonly DataCategory[];
}

export interface CollectFactsResult {
  /** De feiten zoals het model ze krijgt, in bronvolgorde. */
  facts: FactDraft[];
  /** De ruwe respons per bron, voor wie er meer uit nodig heeft. */
  results: Record<string, unknown>;
  /** Bronnen die niet antwoordden, met reden. Voor het beslislog. */
  failures: Array<{ name: string; error: string }>;
  /** Bronnen die niet van toepassing waren (`input` gaf null). */
  skipped: string[];
}

/**
 * Haalt de feiten op waar deze specialist recht op heeft.
 *
 * De bronnen draaien **op volgorde en niet parallel**. Dat kost wat tijd, en
 * het levert iets op wat parallel niet kan: een bron mag leunen op wat een
 * eerdere opleverde. De tracking hangt aan de code die uit de order kwam, en
 * die code is er pas ná de order.
 */
export async function collectFacts(input: CollectFactsInput): Promise<CollectFactsResult> {
  const { pack, specialist, run, recorder, allowedCategories } = input;

  const uit: CollectFactsResult = { facts: [], results: {}, failures: [], skipped: [] };
  const bronnen = providersInScope(pack.facts, specialist.toolScope);
  if (bronnen.length === 0) return uit;

  // Eén cache per run. Bij een compound-mail vragen meerdere specialisten
  // dezelfde order op; zonder dit staat diezelfde lookup er twee keer.
  const cache = new Map<string, FactRunResult>();

  for (const bron of bronnen) {
    const ctx: FactContext = { ...input.ctx, results: uit.results };

    let args: Record<string, unknown> | null;
    try {
      args = bron.input(ctx);
    } catch (err) {
      uit.failures.push({ name: bron.name, error: `input faalde: ${tekst(err)}` });
      continue;
    }
    if (args === null) {
      // De normale uitkomst voor een bron die niet over dit signaal gaat.
      uit.skipped.push(bron.name);
      continue;
    }

    const sleutel = cacheKey(bron.source, args);
    let res = cache.get(sleutel);
    if (!res) {
      const categorieen = begrens(bron.dataCategories, allowedCategories);
      try {
        res = await run({
          source: bron.source,
          input: args,
          dataCategories: categorieen,
          name: bron.name,
        });
      } catch (err) {
        // Een runner die gooit in plaats van {ok:false} teruggeeft, mag de run
        // niet meenemen.
        res = { ok: false, error: tekst(err) };
      }
      cache.set(sleutel, res);
    }

    if (!res.ok) {
      uit.failures.push({ name: bron.name, error: res.error ?? 'geen antwoord' });
      continue;
    }

    uit.results[bron.name] = res.data;

    let feiten: FactDraft[];
    try {
      feiten = bron.toFacts(res.data, ctx) ?? [];
    } catch (err) {
      uit.failures.push({ name: bron.name, error: `toFacts faalde: ${tekst(err)}` });
      continue;
    }

    for (const feit of feiten) {
      if (!feit?.id || !feit.text) continue;
      // Vastleggen mét het antwoord: de grounding-laag controleert straks of
      // een geciteerde waarde bij deze call hoort, en daar heeft ze de inhoud
      // voor nodig.
      recorder.record({ toolCallId: feit.id, tool: sourceLabel(bron.source), result: res.data });
      uit.facts.push(feit);
    }
  }

  return uit;
}

/**
 * De bronnen die deze specialist mag gebruiken, in pakketvolgorde.
 *
 * Een lege `toolScope` levert niets op, en dat is een geldige keuze: `escalate`
 * schrijft een doorverwijzing en heeft geen cijfers nodig, en `gdpr` hoort
 * ordergegevens juist níét te zien.
 *
 * Een naam in de scope die geen bron is, wordt genegeerd. Dat kan een tool zijn
 * die deze klant nog niet heeft; er stilzwijgend niets ophalen is beter dan de
 * run laten stranden — maar het wordt wel gemeld, want het is meestal een typo.
 */
export function providersInScope(
  providers: readonly FactProvider[],
  toolScope: readonly string[],
): FactProvider[] {
  if (toolScope.length === 0) return [];
  const scope = new Set(toolScope);
  const gevonden = providers.filter((p) => scope.has(p.name));

  const namen = new Set(providers.map((p) => p.name));
  for (const naam of toolScope) {
    if (!namen.has(naam)) {
      console.warn(`[feiten] "${naam}" staat in toolScope maar is geen bron van deze module`);
    }
  }
  return gevonden;
}

/**
 * Wat deze bron mag opvragen, doorsneden met wat de agent mag.
 *
 * De agent is de bovengrens: een module kan zijn eigen recht niet oprekken door
 * er een categorie bij te schrijven. Blijft er niets over, dan gaat er een lege
 * lijst mee en snijdt de bron zelf terug — zichtbaar, in plaats van een stille
 * verruiming.
 */
export function begrens(
  gevraagd: readonly DataCategory[],
  toegestaan: readonly DataCategory[],
): DataCategory[] {
  return toegestaan.filter((c) => gevraagd.includes(c));
}

/** Dezelfde bron met dezelfde invoer is dezelfde call. */
function cacheKey(source: FactSource, input: Record<string, unknown>): string {
  const sleutels = Object.keys(input).sort();
  const genormaliseerd = sleutels.map((k) => `${k}=${JSON.stringify(input[k])}`).join('&');
  return `${sourceLabel(source)}|${genormaliseerd}`;
}

/** Hoe deze bron in het beslislog heet. */
export function sourceLabel(source: FactSource): string {
  return source.kind === 'mcp' ? `${source.mcp}:${source.tool}` : `db.${source.table}`;
}

function tekst(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
