import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Signal } from '@factumai/agent-core';

const callMcp = vi.fn();
// Alleen de netwerkcall vervangen, de rest van de module echt laten. De mock
// had `mcpBearer` en `cfAccessHeaders` met de hand nagebouwd; die kopieën
// liepen achter zodra er iets bij kwam, en dan test je een module die niet
// bestaat.
vi.mock('./mcp.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mcp.js')>()),
  callMcp: (...a: unknown[]) => callMcp(...a),
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

/**
 * De mailbox-keuze moet de hele weg afleggen: van env, via `mailEndpoint`,
 * tot in de call. Blijft hij onderweg hangen, dan valt de MCP terug op de
 * primaire instance — en dat is bij een organisatie meestal het adres waar
 * echte klanten naartoe schrijven.
 */
describe('mailbox-keuze', () => {
  it('geeft de ingestelde instance door aan de MCP-call', async () => {
    callMcp.mockResolvedValue({ ok: true, data: { subject: 's', body: 'b' } });
    const metInstance = {
      ...env,
      FACTUMAI_MCP_MAIL_INSTANCE_KEY: 'mail-agent',
    } as unknown as Env;

    await hydrateSignal(metInstance, mailSignal({ messageId: 'AAMk1' }));

    expect(callMcp).toHaveBeenCalledWith(
      expect.objectContaining({ instanceKey: 'mail-agent' }),
      expect.anything(),
      'mail_get_message',
      expect.anything(),
    );
  });

  it('stuurt geen instance mee als er niets is ingesteld', async () => {
    callMcp.mockResolvedValue({ ok: true, data: { subject: 's', body: 'b' } });
    await hydrateSignal(env, mailSignal({ messageId: 'AAMk1' }));
    expect(callMcp.mock.calls[0][0].instanceKey).toBeUndefined();
  });
});
