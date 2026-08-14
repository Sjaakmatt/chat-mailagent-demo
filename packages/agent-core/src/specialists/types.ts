/**
 * Intent-registry types — de config-driven decompositie van "één plan-brein"
 * naar per-intent geoptimaliseerde prompts + tool-scopes (Fase 1 van de
 * multi-agent evolutie). Nog steeds één OrchestrationWorkflow; de router
 * kiest een intent, de plan-stap laadt de bijbehorende IntentConfig.
 *
 * Vanaf Fase 2 kan elke SpecialistWorkflow zijn eigen intent-config lezen
 * uit deze zelfde registry — de shape blijft stabiel over fasen heen.
 */

import { z } from 'zod';
import type { MemoryScope, SpecialistId } from '../contracts/index.js';
import { MemoryScopeSchema, SpecialistIdSchema } from '../contracts/index.js';

/**
 * Signaal aan de LLM-client welk model deze intent nodig heeft. Concreet
 * model-id wordt door de agent-Worker uit env-vars (per specialist) gehaald;
 * dit is puur de tier-hint. `plan-heavy` = Opus-tier voor complex redeneren
 * of vision.
 */
export type IntentModelTier = 'classify' | 'plan' | 'plan-heavy';

export const IntentModelTierSchema = z.enum(['classify', 'plan', 'plan-heavy']);

/**
 * Config per intent: alles wat nodig is om de plan-stap gericht te maken.
 * Geen prompt-tuning-magie — één plek waar per-intent-eigenschappen leven
 * zodat prompt-iteratie voor de klacht-agent geen regressie op de
 * order-change-agent riskeert.
 */
export interface IntentConfig {
  /** Kern-specialisten hard, experimentele kunnen ook (data-driven). */
  id: SpecialistId;
  /** Voor de cockpit + audit-logs. */
  displayName: string;
  /**
   * Korte beschrijving voor de ROUTER-classify-prompt: hier op basis waarvan
   * kiest Haiku deze intent. Wordt letterlijk in de router-system-prompt gezet.
   */
  description: string;
  /**
   * Per-intent system-prompt voor de plan-LLM. Fase 1 vult startskeletten;
   * verdere prompt-tuning gebeurt hier per specialist zonder de andere
   * intents te raken.
   */
  systemPrompt: string;
  /**
   * Whitelist van MCP-tool-namen die deze intent mag aanroepen. `[]` betekent
   * "geen tools" (pure tekst-taak, bv. escalate). De agent-Worker filtert de
   * meegestuurde tool-schemas op deze lijst.
   */
  toolScope: string[];
  /**
   * Welke memory-scopes deze intent moet retrieven vóór het plannen.
   * `PROCESS` zonder tag = alle process-memories; met tag alleen die tag.
   */
  memoryScope: MemoryScope[];
  /**
   * Optionele extra filter binnen PROCESS-scope. Bijvoorbeeld
   * `"order_change"` om alleen order-wijziging-SOP's op te halen.
   */
  memoryProcessTag?: string;
  /**
   * Tier-hint voor de LLM-selectie. Concrete model-id komt uit env-var per
   * specialist (bv. `MODEL_ORDER_CHANGE`).
   */
  modelTierHint: IntentModelTier;
  /**
   * Onder deze confidence gaat de ReviewItem AUTOMATISCH naar strict-review
   * (menselijke controle verplicht), ongeacht triage-tier. 0..1.
   */
  confidenceThreshold: number;
  /**
   * Als true: nooit auto-approve toestaan, zelfs bij hoge confidence. Voor
   * juridische/gevoelige intents (complaint, gdpr).
   */
  needsHitl: boolean;
  /**
   * Als true: de plan-stap krijgt image-attachments meegestuurd (base64) —
   * vereist een vision-capable model. Voor `technical` (defect-analyse
   * op foto's).
   */
  needsVision?: boolean;
}

export const IntentConfigSchema: z.ZodType<IntentConfig> = z.object({
  id: SpecialistIdSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  toolScope: z.array(z.string()),
  memoryScope: z.array(MemoryScopeSchema),
  memoryProcessTag: z.string().optional(),
  modelTierHint: IntentModelTierSchema,
  confidenceThreshold: z.number().min(0).max(1),
  needsHitl: z.boolean(),
  needsVision: z.boolean().optional(),
});

/**
 * Variabelen die in een `systemPrompt` ingevuld worden. Prompts in de registry
 * zijn bewust klant-neutraal geschreven met `{{client}}`-placeholders, zodat
 * één set specialisten voor elke klant werkt.
 */
export interface PromptVars {
  /** Klantnaam zoals de agent 'm tegen de eindklant mag noemen. */
  client: string;
}

/**
 * Vult `{{key}}`-placeholders in een prompt. Onbekende placeholders blijven
 * staan — zichtbaar fout is beter dan stilletjes een lege naam in een mail.
 */
export function renderPrompt(template: string, vars: PromptVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? String(vars[key as keyof PromptVars]) : match,
  );
}
