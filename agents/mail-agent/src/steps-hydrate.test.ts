import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Signal } from '@factumai/agent-core';

const callMcp = vi.fn();
vi.mock('./mcp.js', () => ({
  callMcp: (...a: unknown[]) => callMcp(...a),
  mcpBearer: (env: { FACTUMAI_MCP_INBOUND_SECRET?: string; FACTUMAI_MCP_API_KEY?: string }) =>
    env.FACTUMAI_MCP_INBOUND_SECRET || env.FACTUMAI_MCP_API_KEY || undefined,
  cfAccessHeaders: (env: { CF_ACCESS_CLIENT_ID?: string; CF_ACCESS_CLIENT_SECRET?: string }) =>
    env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET
      ? {
          'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
        }
      : {},
}));

import { hydrateSignal } from './steps.js';
import type { Env } from './env.js';

const env = { FACTUMAI_MCP_MAIL_URL: 'http://mail/mcp', FACTUMAI_MCP_API_KEY: 'k' } as unknown as Env;

function mailSignal(payload: Record<string, unknown>): Signal {
  return {
    id: 'sig-1',
    organizationId: 'org-demo',
    domain: 'mail',
    type: 'mail.received',
    payload,
    status: 'NEW',
    receivedAt: '2026-06-23T10:00:00.000Z',
  };
}

beforeEach(() => callMcp.mockReset());

describe('hydrateSignal', () => {
  it('verrijkt de payload met subject/bodyText/from via mail_get_message', async () => {
    callMcp.mockResolvedValue({
      ok: true,
      data: { subject: 'Waar blijft mijn order?', body: 'Hallo, ...', from: { address: 'klant@example.com' } },
    });
    const out = await hydrateSignal(env, mailSignal({ messageId: 'AAMk1' }));
    expect(callMcp).toHaveBeenCalledWith(
      { url: 'http://mail/mcp', apiKey: 'k', cfAccess: {} },
      expect.objectContaining({ organizationId: 'org-demo' }),
      'mail_get_message',
      { messageId: 'AAMk1' },
    );
    expect(out.payload).toMatchObject({
      messageId: 'AAMk1',
      subject: 'Waar blijft mijn order?',
      bodyText: 'Hallo, ...',
      from: 'klant@example.com',
    });
  });

  it('laat het Signal ongewijzigd zonder messageId (geen MCP-call)', async () => {
    const sig = mailSignal({});
    const out = await hydrateSignal(env, sig);
    expect(callMcp).not.toHaveBeenCalled();
    expect(out).toBe(sig);
  });

  it('laat het Signal ongewijzigd als de MCP-call faalt', async () => {
    callMcp.mockResolvedValue({ ok: false, error: 'boom' });
    const sig = mailSignal({ messageId: 'AAMk1' });
    const out = await hydrateSignal(env, sig);
    expect(out).toBe(sig);
  });
});
