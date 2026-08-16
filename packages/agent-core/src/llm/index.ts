/**
 * Dunne LLM-client-abstractie (Build Document A11). Model-IDs komen uit config,
 * nooit hardcoden. Twee tiers: `classify` (Haiku-tier, snel/goedkoop) en `plan`
 * (Sonnet-tier, het redeneerwerk). De concrete provider (Anthropic-direct, of
 * later Bedrock/Vertex-EU per tenant) leeft achter deze interface — één
 * config-regel om te wisselen.
 *
 * Belangrijk: deze laag hoort in de agent/Workflow-laag. NOOIT in een MCP
 * (harde regel 1: geen LLM in MCP's).
 */

export type ModelTier = 'classify' | 'plan';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteInput {
  tier: ModelTier;
  messages: LlmMessage[];
  /** Resolved model-id uit config; weglaten = de client kiest per tier. */
  model?: string;
  temperature?: number;
}

export interface LlmClient {
  complete(input: LlmCompleteInput): Promise<string>;
}

/** Mapt een tier op een model-id uit config. Geen hardcoded IDs in callers. */
export interface ModelConfig {
  classify: string;
  plan: string;
}

/**
 * Deterministische fake voor unit-tests en demo-modus: geeft een vooraf
 * ingesteld antwoord per tier (of een functie van de input). Geen netwerk.
 */
export class FakeLlmClient implements LlmClient {
  public readonly calls: LlmCompleteInput[] = [];

  constructor(
    private readonly responder:
      | Partial<Record<ModelTier, string>>
      | ((input: LlmCompleteInput) => string),
  ) {}

  async complete(input: LlmCompleteInput): Promise<string> {
    this.calls.push(input);
    if (typeof this.responder === 'function') return this.responder(input);
    return this.responder[input.tier] ?? '';
  }
}

/**
 * De Anthropic-implementatie wordt bewust NIET vanuit deze barrel geëxporteerd.
 * Hij trekt de Anthropic-SDK mee, en dit bestand hangt via de root-barrel aan
 * alles wat `@factumai/agent-core` importeert — inclusief cockpit-componenten
 * die in de browser draaien. Importeer 'm via het subpad:
 *
 *   import { createAnthropicLlmClient } from '@factumai/agent-core/llm-anthropic';
 */
