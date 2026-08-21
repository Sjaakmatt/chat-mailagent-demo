import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import {
  getIntentConfig,
  type ModulePack,
  type PartialResponse,
  type SpecialistId,
} from '@factumai/agent-core';
import type { AggregatorParams, Env } from '../env.js';
import { createPlatformStore } from '../store.js';
import { requirePack } from '../modules.js';
import { buildLlmClient } from '../steps.js';
import { buildCompoundReviewItem, pickPrecedence } from './aggregator-helpers.js';

/**
 * Aggregator-Workflow (Fase 3 — compound fan-in).
 *
 * Wacht tot alle `expectedTasks` PartialResponses voor deze Signal in
 * `aios_partial_responses` staan, weeft hun `proposedContent`-fragmenten met
 * één Sonnet-call samen tot een coherente mail-body, en schrijft één
 * compound ReviewItem in `aios_review_items`.
 *
 * Wachtstrategie: `step.sleep()` in een lus met max-timeout. Voor onze
 * schaal (tot ~5 partials per signaal) is polling voldoende — een event-
 * gedreven barrier via pgmq is de fase-4 upgrade.
 *
 * Precedence-regel: als één van de partials een intent heeft met
 * `needsHitl=true` én andere hebben dat niet, wint de HITL-intent voor
 * toon-bepaling (bv. klacht overrulet neutrale status). Dat komt op de
 * ReviewItem als `precedenceIntent` — de aggregator-prompt gebruikt 'em
 * om de body-toon vast te zetten.
 */

// Fase 3: polling met durable step.sleep. Cloudflare Workflows sluimert
// tussen polls zonder CPU-gebruik; wakker worden = automatische retry-loop.
const MAX_POLL_ATTEMPTS = 40; // 40 × 30s = ~20 min maximum wachttijd
const POLL_INTERVAL = '30 seconds';

export class AggregatorWorkflow extends WorkflowEntrypoint<Env, AggregatorParams> {
  async run(event: WorkflowEvent<AggregatorParams>, step: WorkflowStep): Promise<void> {
    const store = createPlatformStore(this.env);
    const llm = buildLlmClient(this.env);
    const { signalId, expectedTasks } = event.payload;

    // Poll durable. Elke iteratie = één step.do (idempotent + audit-baar).
    // Cloudflare's step.do serialiseert het retour-payload strikt; PartialResponse
    // heeft `unknown`-velden die niet passen in het Serializable-type — daarom
    // JSON-en/ontJSON-en we rond de step-grens.
    let ready = false;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      ready = await step.do(`poll-${attempt}`, async () => {
        const count = await store.countPartialResponses(signalId);
        return count >= expectedTasks;
      });
      if (ready) break;
      await step.sleep(`wait-${attempt}`, POLL_INTERVAL);
    }

    await step.do('aggregate-and-save', async () => {
      const partials = await store.listPartialResponses(signalId);
      const signal = await store.loadSignal(signalId);
      // De router heeft dit signaal al aan een module toegewezen; komt hij hier
      // zonder pakket, dan is dat een bug en geen scenario.
      const pack = requirePack(signal);
      const precedence = pickPrecedence(pack, partials);
      const body = await weavePartials(llm, this.env, pack, signal.payload, partials, precedence);
      const item = buildCompoundReviewItem({
        pack,
        signalId,
        organizationId: signal.organizationId,
        partials,
        expectedTasks,
        body,
        precedence,
      });
      await store.saveReviewItem(item);
    });
  }
}

/**
 * Roept Sonnet aan met alle partials + originele mail en produceert één
 * samenhangende NL mail-body. Geen tool-calls meer — alleen weven van
 * bestaande, gevalideerde tekst. De prompt legt precedence-toon op als die
 * gezet is.
 */
async function weavePartials(
  llm: ReturnType<typeof buildLlmClient>,
  env: Env,
  pack: ModulePack,
  payload: Record<string, unknown>,
  partials: PartialResponse[],
  precedence: SpecialistId | null,
): Promise<string> {
  const subject = typeof payload.subject === 'string' ? payload.subject : '';
  const bodyText = typeof payload.bodyText === 'string' ? payload.bodyText : '';
  const precedenceLine = precedence
    ? `PRIORITEIT-TOON: deze mail bevat een ${(getIntentConfig(pack.specialists, precedence)?.displayName ?? precedence).toLowerCase()}-element. Neem die toon aan voor het HELE antwoord — zelfs voor de neutrale deel-antwoorden.`
    : 'Neem een neutraal-zakelijke toon aan.';

  const partialsText = partials
    .map((p, i) => {
      const label = getIntentConfig(pack.specialists, p.intent)?.displayName ?? p.intent;
      const header = `[deel ${i + 1} — ${label} — status: ${p.status}]`;
      return `${header}\n${p.proposedContent || '(geen concept — specialist gaf op)'}`;
    })
    .join('\n\n');

  const out = await llm.complete({
    tier: 'plan',
    model: env.MODEL_PLAN,
    messages: [
      {
        role: 'system',
        content: [
          'Je weeft meerdere deel-antwoorden samen tot ÉÉN Nederlandse mail-body voor een klant.',
          precedenceLine,
          'Regels:',
          '- Verzin NIETS. Gebruik alleen de feiten uit de deel-antwoorden hieronder.',
          '- Combineer de deel-antwoorden in een logische volgorde met vloeiende overgangen ("Wat betreft uw ...", "Daarnaast ..."). Herhaal geen aanhef per deel.',
          '- Deel-antwoorden met status "needs_human" of "error": vermeld kort dat een collega dit deel oppakt; kopieer geen (mogelijk incomplete) tekst uit dat deel.',
          '- Eén aanhef bovenaan, één afsluiting onderaan. Geen JSON — alleen platte tekst.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Oorspronkelijke mail — onderwerp: ${subject}`,
          bodyText,
          '',
          'Deel-antwoorden om samen te weven:',
          partialsText,
        ].join('\n'),
      },
    ],
  });
  return out.trim();
}

