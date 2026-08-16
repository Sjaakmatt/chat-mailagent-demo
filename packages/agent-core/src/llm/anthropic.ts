import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmCompleteInput, ModelConfig, ModelTier } from './index.js';

/**
 * Anthropic-implementatie van de `LlmClient` (Build Document A11:
 * dunne abstractie, model-IDs uit config, Haiku-tier classify / Sonnet-tier
 * plan). Later per tenant te wisselen naar Bedrock/Vertex-EU — één plek.
 *
 * `system`-rol-berichten worden naar de top-level `system`-parameter gelift
 * (de Messages-API neemt system niet in `messages` op). Geen `temperature`:
 * recente modellen wijzen die af; we sturen 'm niet mee.
 */
const MAX_TOKENS: Record<ModelTier, number> = {
  classify: 1024,
  plan: 8192,
};

export interface AnthropicLlmOptions {
  apiKey: string;
  models: ModelConfig;
}

export function createAnthropicLlmClient(opts: AnthropicLlmOptions): LlmClient {
  const client = new Anthropic({ apiKey: opts.apiKey });

  return {
    async complete(input: LlmCompleteInput): Promise<string> {
      const model = input.model ?? opts.models[input.tier];
      const systemParts = input.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content);
      const messages = input.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const res = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS[input.tier],
        ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
        messages,
      });

      return res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    },
  };
}
