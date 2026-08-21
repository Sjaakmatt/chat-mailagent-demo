/**
 * De klok als ingang — `aios_automations` uitlezen en emitten.
 *
 * ## De verdeling
 *
 * De **database** bepaalt óf en wanneer iets draait: een rij in
 * `aios_automations` met een naam, een rooster en een aan/uit-vlag. Een
 * beheerder zet een automatisering uit zonder deploy.
 *
 * De **code** bepaalt wát een tik oplevert: de `ScheduledAutomation` op het
 * modulepakket, die de tik omzet in nul of meer signalen. Niemand kan er een
 * taak bij verzinnen zonder code, en de expander gebruikt geen model — hij
 * stelt vast wat er is.
 *
 * Kent geen enkele module de naam uit de rij, dan emitten we alsnog één kaal
 * signaal `schedule.<naam>`. Dat is met opzet: de rij zegt dat er iets moet
 * gebeuren, en dan hoort dat zichtbaar te worden in plaats van stil te blijven
 * omdat de code er nog niet is.
 *
 * ## Ontdubbeling
 *
 * De idempotency-sleutel bevat de tijdsleuf (`auto:<naam>:2026-08-21`). Twee
 * cron-tikken binnen dezelfde sleuf leveren dezelfde sleutel op, en de
 * transactional outbox houdt er één over. `last_run_at` is daar een tweede net
 * onder: die voorkomt dat we elke tik opnieuw álles ophalen.
 */

import {
  MODULE_PACKS,
  automationByName,
  isDue,
  parseSchedule,
  scheduleIdempotencyKey,
  scheduleSignalType,
  slotFor,
  type ModuleTriggers,
  type SignalDraft,
  type TriggerContext,
} from '@factumai/agent-core';
import type { Env } from '../env.js';
import { emitSignal, intakeClient, intakeCtx } from './emit.js';

/** Eén rij uit `aios_automations`. */
interface AutomationRow {
  id: string;
  name: string;
  trigger: string;
  schedule: string | null;
  enabled: boolean;
  module: string | null;
  last_run_at: string | null;
  config: Record<string, unknown> | null;
}

export interface RunAutomationsResult {
  bekeken: number;
  gedraaid: number;
  geemit: number;
}

/**
 * Draait de automatiseringen die aan de beurt zijn.
 *
 * Fail-soft per automatisering: één expander die omvalt mag de rest van de tik
 * niet meenemen. Een cron die stilvalt is erger dan een automatisering die een
 * ronde overslaat.
 */
export async function runAutomations(
  env: Env,
  now: Date = new Date(),
): Promise<RunAutomationsResult> {
  const client = intakeClient(env);
  const ctx = intakeCtx(env);
  const resultaat: RunAutomationsResult = { bekeken: 0, gedraaid: 0, geemit: 0 };

  let rijen: AutomationRow[];
  try {
    const url = client.tableUrl('aios_automations');
    url.searchParams.set('organization_id', `eq.${env.AIOS_ORG_ID}`);
    url.searchParams.set('enabled', 'eq.true');
    url.searchParams.set('trigger', 'eq.schedule');
    url.searchParams.set('limit', '200');
    const res = await client.request<AutomationRow[]>(ctx, url, { method: 'GET' });
    rijen = Array.isArray(res) ? res : [];
  } catch (err) {
    console.error(
      `[cron] kon aios_automations niet lezen: ${err instanceof Error ? err.message : String(err)}`,
    );
    return resultaat;
  }

  for (const rij of rijen) {
    resultaat.bekeken += 1;

    const schedule = parseSchedule(rij.schedule);
    if (!schedule) {
      // Luid melden en overslaan. Een onleesbaar rooster stilzwijgend als
      // "elk uur" behandelen geeft een ander ritme dan er staat, en dat merkt
      // niemand tot de kosten oplopen.
      console.warn(
        `[cron] automatisering "${rij.name}": onleesbaar rooster ${JSON.stringify(rij.schedule)} — overgeslagen`,
      );
      continue;
    }
    if (!isDue(schedule, now, rij.last_run_at)) continue;

    const slot = slotFor(schedule, now);
    resultaat.gedraaid += 1;

    let drafts: SignalDraft[];
    try {
      drafts = await expand(env, client, ctx, rij, now);
    } catch (err) {
      console.error(
        `[cron] automatisering "${rij.name}" faalde: ${err instanceof Error ? err.message : String(err)}`,
      );
      // `last_run_at` niet zetten: dan probeert de volgende tik het opnieuw.
      // Dat is de bedoeling bij een storing, en de idempotency-sleutel zorgt
      // dat een geslaagde herhaling binnen dezelfde sleuf niets dubbel doet.
      continue;
    }

    for (const draft of drafts) {
      try {
        const { enqueued } = await emitSignal(
          env,
          {
            domain: draft.domain,
            type: draft.type,
            payload: draft.payload,
            idempotencyKey: scheduleIdempotencyKey({
              name: rij.name,
              slot,
              key: draft.key,
            }),
          },
          client,
        );
        if (enqueued) resultaat.geemit += 1;
      } catch (err) {
        console.error(
          `[cron] emitten mislukt voor "${rij.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await markeerGedraaid(client, ctx, rij.id, now);
    console.log(
      `[cron] automatisering "${rij.name}" (${slot}): ${drafts.length} signaal(en)`,
    );
  }

  return resultaat;
}

/**
 * Zet de tik om in signalen.
 *
 * Kent een module deze naam, dan bepaalt die wat eruit komt. Zo niet, dan één
 * kaal signaal — de rij zegt dat er iets moet gebeuren, en dat hoort niet stil
 * te blijven omdat de code er nog niet is.
 */
async function expand(
  env: Env,
  client: ReturnType<typeof intakeClient>,
  ctx: ReturnType<typeof intakeCtx>,
  rij: AutomationRow,
  now: Date,
): Promise<SignalDraft[]> {
  const triggers: ModuleTriggers[] = MODULE_PACKS.map((p) => p.triggers ?? {});
  const automatisering = automationByName(triggers, rij.name);
  const type = scheduleSignalType(rij.name);

  if (!automatisering) {
    console.warn(
      `[cron] geen module kent automatisering "${rij.name}" — kaal signaal geëmit`,
    );
    return [
      {
        domain: 'schedule',
        type,
        payload: {
          automation: rij.name,
          subject: `Geplande taak: ${rij.name}`,
          bodyText: '',
          occurredAt: now.toISOString(),
          config: rij.config ?? {},
        },
      },
    ];
  }

  const context: TriggerContext = {
    organizationId: env.AIOS_ORG_ID,
    now,
    config: rij.config ?? {},
    async query<T>(tabel: string, params: Record<string, string>): Promise<T[]> {
      const url = client.tableUrl(tabel);
      url.searchParams.set('organization_id', `eq.${env.AIOS_ORG_ID}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const res = await client.request<T[]>(ctx, url, { method: 'GET' });
      return Array.isArray(res) ? res : [];
    },
  };

  const drafts = await automatisering.expand(context);
  // De expander bepaalt de inhoud, niet het type: zo kan hij het signaaltype
  // niet per ongeluk laten afwijken van de naam waarop een module claimt.
  return drafts.map((d) => ({ ...d, domain: d.domain || 'schedule', type }));
}

/** Onthoudt dat deze automatisering gedraaid heeft. Best-effort. */
async function markeerGedraaid(
  client: ReturnType<typeof intakeClient>,
  ctx: ReturnType<typeof intakeCtx>,
  id: string,
  now: Date,
): Promise<void> {
  try {
    const url = client.tableUrl('aios_automations');
    url.searchParams.set('id', `eq.${id}`);
    await client.request<unknown>(ctx, url, {
      method: 'PATCH',
      body: JSON.stringify({ last_run_at: now.toISOString() }),
      prefer: 'return=minimal',
    });
  } catch (err) {
    // Niet fataal: de idempotency-sleutel houdt een dubbele tik alsnog tegen.
    // Wel melden, want zonder deze stempel doet elke tik het werk opnieuw.
    console.warn(
      `[cron] last_run_at zetten mislukt voor ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
