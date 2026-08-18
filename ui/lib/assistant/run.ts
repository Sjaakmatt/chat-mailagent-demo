/**
 * Eén vraag aan de assistent, van bronnen tot gevalideerd antwoord.
 *
 * De volgorde is de hele architectuur:
 *
 *   bronnen ophalen → prompt bouwen → model → parsen → **controleren** → tonen
 *
 * Die controle is geen laatste stap maar de reden dat de rest zo is. Het model
 * krijgt uitsluitend de bronnen te zien die hier worden verzameld, en elk
 * antwoord moet daarnaar herleidbaar zijn. Zakt het, dan houdt
 * `finalizeAssistantAnswer` het in — er is geen pad waarlangs een ongecontroleerd
 * antwoord het scherm haalt.
 *
 * De assistent schrijft niets. Er zit hier geen enkele mutatie in, en dat is
 * met opzet: hij is een raadpleegvenster, en dat moet je aan de code kunnen
 * zien en niet alleen aan de prompt.
 */

import {
  buildAssistantPrompt,
  finalizeAssistantAnswer,
  parseAssistantAnswer,
  type AggregationSummary,
  type AssistantResult,
  type AssistantSource,
  type AssistantTurn,
  type DataCategory,
} from "@factumai/agent-core";
import { createAnthropicLlmClient } from "@factumai/agent-core/llm-anthropic";
import { BRAND } from "@/lib/brand";
import type { CockpitEnv } from "@/lib/env";
import type { CockpitDbClient } from "@/lib/tenant-query";
import type { ReviewItemRow } from "@/lib/review";
import type { WorkbenchModule } from "@/lib/modules";
import { planAndRunAggregation } from "./analyse-run";

/** Is de assistent aan voor deze cockpit? */
export function assistantEnabled(env: CockpitEnv): boolean {
  // Alleen de letterlijke "true", en alleen mét sleutel: een halve configuratie
  // hoort een uitgeschakelde assistent op te leveren en geen 500 bij de eerste
  // vraag.
  return env.ASSISTANT_DOSSIER === "true" && Boolean(env.ANTHROPIC_API_KEY);
}

export interface AssistantRunResult {
  result: AssistantResult;
  /** Alle bronnen die het model kreeg — ook de niet-geciteerde. */
  sources: AssistantSource[];
  /**
   * De uitgevoerde aggregatie, als de vraag er een opleverde. De cockpit toont
   * hem apart mét periode, populatie en definitie — standaard zichtbaar, want
   * een cijfer zonder die drie is niet te controleren.
   */
  aggregatie?: { tool: string; resultaat: AggregationSummary };
}

export interface AskOptions {
  /** Laag 2 aan? Alleen dan mag de assistent een aggregatie uitvoeren. */
  analyse?: boolean;
  /**
   * De eerdere beurten uit dit gesprek. Context om een vervolgvraag te
   * begrijpen — géén bron: de controle onderaan kijkt alleen naar de bronnen
   * van déze beurt.
   */
  history?: readonly AssistantTurn[];
  /** De categorieën van de vragensteller; gaan mee op de MCP-call. */
  categories?: readonly DataCategory[];
  /** Vandaag, als ISO-datum — zodat "vorige maand" te vertalen is. */
  vandaag?: string;
}

/**
 * Eén vraag aan de assistent.
 *
 * `row` mag null zijn: de assistent zit in de schil en niet op een
 * detailscherm, dus een medewerker kan hem aanspreken zonder dat er een
 * voorstel openstaat. Dat is een ander gesprek en dus een andere bronnenset —
 * beleid en werkvoorraad in plaats van een klantdossier — maar dezelfde regel:
 * elke bewering herleidbaar naar een bron uit deze beurt.
 */
export async function askAssistant(
  env: CockpitEnv,
  client: CockpitDbClient,
  mod: WorkbenchModule,
  row: ReviewItemRow | null,
  question: string,
  options: AskOptions = {},
): Promise<AssistantRunResult> {
  // De bronnen komen van de módule, niet van een gedeelde functie met een
  // module-parameter. Zo kan de klantenservice-assistent geen sales-bron
  // krijgen, ook niet als er ergens een verkeerde id wordt doorgegeven.
  const sources = row
    ? mod.collectSources
      ? await mod.collectSources(client, row)
      : []
    : mod.collectGeneralSources
      ? await mod.collectGeneralSources(client)
      : [];

  const llm = createAnthropicLlmClient({
    apiKey: env.ANTHROPIC_API_KEY ?? "",
    models: {
      classify: env.MODEL_ASSISTANT ?? "claude-sonnet-4-6",
      plan: env.MODEL_ASSISTANT ?? "claude-sonnet-4-6",
    },
  });

  // Laag 2: het model kiest een aggregatie, de MCP rekent, en het resultaat
  // wordt een gewone bron. Mislukt dat, dan gaat de vraag alsnog door het
  // dossier-pad — een analysevraag die niet lukt, is nog steeds een vraag.
  let aggregatie: AssistantRunResult["aggregatie"];
  if (options.analyse) {
    const outcome = await planAndRunAggregation(
      env,
      question,
      options.categories ?? ["operationeel"],
      options.vandaag ?? new Date().toISOString().slice(0, 10),
      (messages) => llm.complete({ tier: "plan", messages }),
    );
    if (outcome.ok) {
      sources.push(outcome.source);
      aggregatie = { tool: outcome.tool, resultaat: outcome.aggregatie };
    } else {
      // De weigering is zelf een bruikbaar antwoord: "die aggregatie bestaat
      // hier niet" is precies wat de briefing wil horen in plaats van een
      // benadering.
      return {
        sources,
        aggregatie: undefined,
        result: {
          ok: false,
          reason: "geen_bron",
          message: outcome.reden,
          detail: { onbekendeBronnen: [], ongedekteGetallen: [] },
        },
      };
    }
  }

  const messages = buildAssistantPrompt({
    question,
    contextLabel: row
      ? `voorstel ${row.id} — ${row.summary}`
      : `${mod.label} — geen voorstel geopend; vragen gaan over het proces zelf`,
    sources,
    clientName: env.CLIENT_NAME?.trim() || BRAND.name,
    history: options.history,
  });

  let raw: string;
  try {
    raw = await llm.complete({ tier: "plan", messages });
  } catch {
    // Een hapering bij de provider is geen reden om iets te verzinnen; de
    // gebruiker krijgt een weigering met een reden en kan het opnieuw proberen.
    return {
      sources,
      result: {
        ok: false,
        reason: "onleesbaar",
        message: "De assistent is nu niet bereikbaar. Probeer het zo nog eens.",
        detail: { onbekendeBronnen: [], ongedekteGetallen: [] },
      },
    };
  }

  return {
    sources,
    aggregatie,
    result: finalizeAssistantAnswer(parseAssistantAnswer(raw), sources),
  };
}
