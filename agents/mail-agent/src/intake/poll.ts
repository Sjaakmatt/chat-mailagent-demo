/**
 * De poll als ingang — bronnen die zelf niets sturen, periodiek bevragen.
 *
 * ## Waarom naast de webhook
 *
 * Een webhook is beter: het systeem meldt zich zodra er iets gebeurt, en wij
 * doen niets als er niets is. Maar lang niet elk systeem stuurt er een. Een
 * ouder ERP, een boekhoudpakket met alleen een REST-API, een leverancier met
 * een orderportaal: daar is periodiek zelf kijken de enige manier. Zonder deze
 * ingang zijn die klanten alleen te bedienen als iemand het overtypt in een
 * mail.
 *
 * ## De cursor
 *
 * Elke bron heeft één rij in `aios_poll_cursors` per (organisatie, module,
 * bron). Daarin staat de hoogste waarde van het cursorveld die we hebben
 * gezien; alles daarna is nieuw. Dat is goedkoper dan elke ronde alles ophalen,
 * en het is het enige dat werkt bij een bron die geen "sinds"-filter kent.
 *
 * De cursor schuift **per rij op, in volgorde**, en alleen na een geslaagde
 * emit. Struikelt de bus halverwege, dan staat de cursor op de laatste rij die
 * het wél haalde en pakt de volgende ronde de rest op. Eén keer aan het eind de
 * hoogste waarde wegschrijven zou de tussenliggende rijen stilzwijgend
 * overslaan, en dat is precies het soort verlies dat niemand merkt.
 *
 * ## Fail-soft
 *
 * Een MCP die niet antwoordt zet `last_error` en laat de cursor staan. De
 * volgende ronde begint dan op hetzelfde punt. Een fout die de cursor vooruit
 * zet, slaat rijen over; een fout die de hele tik afbreekt, neemt de andere
 * bronnen mee. Geen van beide mag.
 */

import {
  MODULE_PACKS,
  pollIdempotencyKey,
  rowsAfterCursor,
  type DataCategory,
  type PollDefinition,
  type SignalDraft,
} from '@factumai/agent-core';
// De MCP-client achter zijn subpad, net als in steps.ts — zo blijft de SDK uit
// de browserbundel van de cockpit.
import {
  callMcp,
  cfAccessHeaders,
  mcpBearer,
  type McpEndpoint,
} from '@factumai/agent-core/mcp';
import type { Env } from '../env.js';
import { agentDataCategories } from '../steps.js';
import { emitSignal, intakeClient, intakeCtx } from './emit.js';

/** Eén poll, met de module waar hij bij hoort. */
export interface ModulePoll {
  module: string;
  poll: PollDefinition;
}

/** Eén rij uit `aios_poll_cursors`. */
interface CursorRow {
  cursor: string | null;
}

export interface RunPollsResult {
  bekeken: number;
  /** Rijen die na de cursor kwamen. */
  nieuw: number;
  /** Signalen die daadwerkelijk op de bus kwamen. */
  geemit: number;
  /** Bronnen die deze ronde een fout opleverden. */
  mislukt: number;
}

/**
 * Hoeveel rijen één ronde per bron hooguit verwerkt.
 *
 * Een eerste run op een bestaande administratie kan duizenden rijen opleveren.
 * Die in één cron-tik door de lus duwen is een rekening en een werkbak vol; de
 * cursor zorgt dat de volgende ronde verdergaat waar deze stopte.
 */
const MAX_PER_RONDE = 50;

/** De polls van de gelicentieerde modules. Het manifest bepaalt welke dat zijn. */
export function modulePolls(): ModulePoll[] {
  return MODULE_PACKS.flatMap((pack) =>
    (pack.triggers?.polls ?? []).map((poll) => ({
      module: pack.descriptor.id,
      poll,
    })),
  );
}

/**
 * Bevraagt de bronnen van de gelicentieerde modules en emit per nieuwe rij een
 * signaal.
 *
 * `polls` is injecteerbaar zodat een test niet afhangt van welke modules er
 * toevallig in het manifest staan.
 */
export async function runPolls(
  env: Env,
  now: Date = new Date(),
  polls: readonly ModulePoll[] = modulePolls(),
): Promise<RunPollsResult> {
  const resultaat: RunPollsResult = { bekeken: 0, nieuw: 0, geemit: 0, mislukt: 0 };
  if (polls.length === 0) return resultaat;

  const client = intakeClient(env);

  for (const { module, poll } of polls) {
    resultaat.bekeken += 1;
    try {
      const ronde = await draaiPoll(env, client, module, poll, now);
      resultaat.nieuw += ronde.nieuw;
      resultaat.geemit += ronde.geemit;
      if (ronde.fout) resultaat.mislukt += 1;
    } catch (err) {
      // Mag niet gebeuren — `draaiPoll` vangt zelf af — maar een bron die hier
      // toch doorheen breekt, mag de andere niet meenemen.
      resultaat.mislukt += 1;
      console.error(
        `[poll] ${module}/${poll.source} viel om: ${foutTekst(err)}`,
      );
    }
  }

  return resultaat;
}

interface RondeResult {
  nieuw: number;
  geemit: number;
  fout: string | null;
}

/** Eén bron, één ronde. Gooit niet: elke uitkomst is een `RondeResult`. */
async function draaiPoll(
  env: Env,
  client: ReturnType<typeof intakeClient>,
  module: string,
  poll: PollDefinition,
  now: Date,
): Promise<RondeResult> {
  const endpoint = endpointVoor(env, poll);
  if (!endpoint) {
    // Geen URL betekent meestal: deze klant heeft dit systeem niet. Toch
    // vastleggen en niet alleen loggen — een poll die maanden stilstaat omdat
    // een var ontbreekt, hoort zichtbaar te zijn op de plek waar je kijkt.
    const fout = `geen URL geconfigureerd (${poll.mcp})`;
    await schrijfCursor(client, env, module, poll.source, { now, fout });
    return { nieuw: 0, geemit: 0, fout };
  }

  let cursor: string | null;
  try {
    cursor = await leesCursor(client, env, module, poll.source);
  } catch (err) {
    // De database is niet bereikbaar. Dan heeft het geen zin de bron te
    // bevragen: we zouden niet weten waar we gebleven waren, en het antwoord
    // ook nergens kwijt kunnen.
    return { nieuw: 0, geemit: 0, fout: `cursor lezen mislukt: ${foutTekst(err)}` };
  }

  const ctx = {
    ...intakeCtx(env),
    // Zonder dit snijdt de MCP terug naar `operationeel` en verdwijnen velden
    // stilzwijgend (docs/RECHTEN.md). Begrensd door wat de agent zelf mag: een
    // poll kan niet meer opvragen dan de agent is toegestaan.
    dataCategories: begrensdeCategorieen(env, poll.dataCategories),
  };

  const res = await callMcp<unknown>(endpoint, ctx, poll.tool, {
    ...(poll.input ?? {}),
    // De bron mag zelf filteren als hij dat kan; kan hij het niet, dan doet
    // `rowsAfterCursor` het aan onze kant.
    ...(cursor ? { since: cursor } : {}),
    limit: MAX_PER_RONDE,
  });

  if (!res.ok) {
    const fout = res.error ?? `${poll.tool} gaf geen antwoord`;
    console.warn(`[poll] ${module}/${poll.source}: ${fout} — cursor blijft staan`);
    await schrijfCursor(client, env, module, poll.source, { now, fout });
    return { nieuw: 0, geemit: 0, fout };
  }

  const { rijen } = rowsAfterCursor(rijenUit(res.data), poll.cursorField, cursor);
  if (rijen.length === 0) {
    await schrijfCursor(client, env, module, poll.source, { now, cursor });
    return { nieuw: 0, geemit: 0, fout: null };
  }

  // Op volgorde, want de cursor schuift per rij op. Ongesorteerd zou de eerste
  // hoge waarde alles wat erna komt onbereikbaar maken.
  rijen.sort((a, b) => String(a[poll.cursorField]).localeCompare(String(b[poll.cursorField])));

  let bereikt = cursor;
  let geemit = 0;
  let fout: string | null = null;

  for (const rij of rijen.slice(0, MAX_PER_RONDE)) {
    const waarde = String(rij[poll.cursorField]);

    let draft: SignalDraft | null;
    try {
      draft = poll.toSignal(rij);
    } catch (err) {
      // Een rij die de vertaler laat struikelen, blokkeert anders elke ronde
      // opnieuw op hetzelfde punt. Melden, cursor door, volgende rij.
      console.error(`[poll] ${module}/${poll.source} rij ${waarde}: ${foutTekst(err)}`);
      bereikt = waarde;
      continue;
    }

    // `null` is een geldig antwoord: niet elke opgehaalde rij is een signaal
    // waard. De cursor schuift wel op, anders komt hij elke ronde terug.
    if (!draft) {
      bereikt = waarde;
      continue;
    }

    try {
      const { enqueued } = await emitSignal(
        env,
        {
          domain: draft.domain,
          type: draft.type,
          payload: draft.payload,
          idempotencyKey: pollIdempotencyKey({ module, source: poll.source, cursor: waarde }),
        },
        client,
      );
      if (enqueued) geemit += 1;
      bereikt = waarde;
    } catch (err) {
      // Stoppen, niet doorlopen: de cursor staat op de vorige rij en de
      // volgende ronde begint hier opnieuw. Doorlopen zou déze rij overslaan
      // zodra een latere wél lukt.
      fout = `emitten mislukt bij ${waarde}: ${foutTekst(err)}`;
      console.error(`[poll] ${module}/${poll.source}: ${fout}`);
      break;
    }
  }

  await schrijfCursor(client, env, module, poll.source, { now, cursor: bereikt, fout });
  console.log(
    `[poll] ${module}/${poll.source}: ${rijen.length} nieuw, ${geemit} geëmit, cursor ${bereikt ?? '-'}`,
  );

  return { nieuw: rijen.length, geemit, fout };
}

/** De MCP achter deze poll, of null als er geen URL voor staat. */
function endpointVoor(env: Env, poll: PollDefinition): McpEndpoint | null {
  const url = (env as unknown as Record<string, string | undefined>)[poll.mcp]?.trim();
  if (!url) return null;
  return { url, apiKey: mcpBearer(env), cfAccess: cfAccessHeaders(env) };
}

/**
 * Wat deze poll mag opvragen, doorsneden met wat de agent mag.
 *
 * Een poll die meer vraagt dan de agent is toegestaan, krijgt niet meer: de
 * grens staat in `AGENT_DATA_CATEGORIES` en een moduledefinitie mag daar niet
 * overheen. Blijft er niets over, dan sturen we een lege lijst mee en snijdt de
 * MCP zelf terug — zichtbaar, in plaats van een stille verruiming.
 */
function begrensdeCategorieen(
  env: Env,
  gevraagd: readonly DataCategory[],
): DataCategory[] {
  const toegestaan = agentDataCategories(env);
  return toegestaan.filter((c) => gevraagd.includes(c));
}

/**
 * De rijen uit een MCP-antwoord.
 *
 * MCP-tools geven hun lijst onder wisselende namen terug. Hier de gangbare
 * omhulsels afpellen in plaats van elke `toSignal` ermee opzadelen.
 */
function rijenUit(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== 'object') return [];
  for (const sleutel of ['items', 'rows', 'results', 'data', 'records']) {
    const waarde = (data as Record<string, unknown>)[sleutel];
    if (Array.isArray(waarde)) return waarde as Record<string, unknown>[];
  }
  return [];
}

/** De cursor van deze bron, of null als hij nog nooit gedraaid heeft. */
async function leesCursor(
  client: ReturnType<typeof intakeClient>,
  env: Env,
  module: string,
  source: string,
): Promise<string | null> {
  try {
    const url = client.tableUrl('aios_poll_cursors');
    url.searchParams.set('organization_id', `eq.${env.AIOS_ORG_ID}`);
    url.searchParams.set('module', `eq.${module}`);
    url.searchParams.set('source', `eq.${source}`);
    url.searchParams.set('select', 'cursor');
    url.searchParams.set('limit', '1');
    const rijen = await client.request<CursorRow[]>(intakeCtx(env), url, { method: 'GET' });
    const cursor = Array.isArray(rijen) ? rijen[0]?.cursor : null;
    return cursor ?? null;
  } catch (err) {
    // Niet raden. Een onleesbare cursor als "leeg" behandelen betekent de hele
    // bron opnieuw ophalen; dan is overslaan goedkoper en stiller.
    console.error(`[poll] cursor lezen mislukt voor ${module}/${source}: ${foutTekst(err)}`);
    throw err;
  }
}

/** Legt vast waar we gebleven zijn, en wat er misging. Best-effort. */
async function schrijfCursor(
  client: ReturnType<typeof intakeClient>,
  env: Env,
  module: string,
  source: string,
  velden: { now: Date; cursor?: string | null; fout?: string | null },
): Promise<void> {
  try {
    const url = client.tableUrl('aios_poll_cursors');
    const rij: Record<string, unknown> = {
      organization_id: env.AIOS_ORG_ID,
      module,
      source,
      last_run_at: velden.now.toISOString(),
      last_error: velden.fout ?? null,
      updated_at: velden.now.toISOString(),
    };
    // Alleen meesturen als we 'm kennen: een fout mag de bestaande cursor niet
    // op null zetten.
    if (velden.cursor !== undefined) rij.cursor = velden.cursor;

    await client.request<unknown>(intakeCtx(env), url, {
      method: 'POST',
      body: JSON.stringify(rij),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  } catch (err) {
    // Niet fataal: de idempotency-sleutel houdt dubbele signalen alsnog tegen.
    // Wel melden, want zonder cursor haalt de volgende ronde alles opnieuw op.
    console.warn(`[poll] cursor schrijven mislukt voor ${module}/${source}: ${foutTekst(err)}`);
  }
}

function foutTekst(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
