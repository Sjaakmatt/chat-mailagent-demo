import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
    constructor(_opts: unknown) {}
  },
}));

import { createAnthropicLlmClient } from './anthropic.js';

beforeEach(() => create.mockReset());

describe('createAnthropicLlmClient', () => {
  it('lift system-rol, kiest model per tier, extraheert alleen tekstblokken', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: '...' },
        { type: 'text', text: 'Hallo ' },
        { type: 'text', text: 'wereld' },
      ],
    });

    const llm = createAnthropicLlmClient({
      apiKey: 'k',
      models: { classify: 'haiku-id', plan: 'sonnet-id' },
    });

    const out = await llm.complete({
      tier: 'plan',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'u' },
      ],
    });

    expect(out).toBe('Hallo wereld');
    const arg = create.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.model).toBe('sonnet-id');
    expect(arg.system).toBe('sys');
    expect(arg.max_tokens).toBe(8192);
    expect(arg.messages).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('gebruikt het classify-model + lagere max_tokens en stuurt geen system mee als die er niet is', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const llm = createAnthropicLlmClient({
      apiKey: 'k',
      models: { classify: 'haiku-id', plan: 'sonnet-id' },
    });
    await llm.complete({ tier: 'classify', messages: [{ role: 'user', content: 'x' }] });
    const arg = create.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.model).toBe('haiku-id');
    expect(arg.max_tokens).toBe(1024);
    expect('system' in arg).toBe(false);
  });
});
