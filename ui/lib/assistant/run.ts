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
  type AssistantResult,
  type AssistantSource,
} from "@factumai/agent-core";
import { createAnthropicLlmClient } from "@factumai/agent-core/llm-anthropic";
import { BRAND } from "@/lib/brand";
import type { CockpitEnv } from "@/lib/env";
import type { CockpitDbClient } from "@/lib/tenant-query";
import type { ReviewItemRow } from "@/lib/review";
import type { WorkbenchModule } from "@/lib/modules";

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
}

export async function askAssistant(
  env: CockpitEnv,
  client: CockpitDbClient,
  mod: WorkbenchModule,
  row: ReviewItemRow,
  question: string,
): Promise<AssistantRunResult> {
  // De bronnen komen van de módule, niet van een gedeelde functie met een
  // module-parameter. Zo kan de klantenservice-assistent geen sales-bron
  // krijgen, ook niet als er ergens een verkeerde id wordt doorgegeven.
  const sources = mod.collectSources ? await mod.collectSources(client, row) : [];

  const llm = createAnthropicLlmClient({
    apiKey: env.ANTHROPIC_API_KEY ?? "",
    models: {
      classify: env.MODEL_ASSISTANT ?? "claude-sonnet-4-6",
      plan: env.MODEL_ASSISTANT ?? "claude-sonnet-4-6",
    },
  });

  const messages = buildAssistantPrompt({
    question,
    contextLabel: `voorstel ${row.id} — ${row.summary}`,
    sources,
    clientName: env.CLIENT_NAME?.trim() || BRAND.name,
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

  return { sources, result: finalizeAssistantAnswer(parseAssistantAnswer(raw), sources) };
}
