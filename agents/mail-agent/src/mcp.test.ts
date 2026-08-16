import { describe, it, expect } from 'vitest';
import { mailEndpoint, mcpBearer, cfAccessHeaders } from './mcp.js';

/**
 * De instance-keuze is niet cosmetisch. Eén org kan meerdere mailboxen hebben
 * gekoppeld; laat je de sleutel leeg, dan kiest de MCP de primaire — en dat is
 * doorgaans het adres waar echte klanten naartoe schrijven. Deze agent leest
 * daar niet alleen uit, hij antwoordt er ook vanuit.
 */
describe('mailEndpoint', () => {
  const basis = {
    FACTUMAI_MCP_MAIL_URL: 'https://mcp-mail.example.com/mcp',
    FACTUMAI_MCP_INBOUND_SECRET: 'geheim',
  };

  it('geeft null zonder URL, zodat de caller zelf kan beslissen', () => {
    expect(mailEndpoint({})).toBeNull();
  });

  it('neemt de ingestelde instance over', () => {
    const ep = mailEndpoint({ ...basis, FACTUMAI_MCP_MAIL_INSTANCE_KEY: 'mail-agent' });
    expect(ep?.instanceKey).toBe('mail-agent');
  });

  // Leeg of spaties = niets meesturen. Een lege string zou als instanceKey
  // meegaan en op de MCP-kant een instance zijn die niet bestaat.
  it('behandelt leeg en whitespace als "niet gezet"', () => {
    for (const leeg of [undefined, '', '   ']) {
      const ep = mailEndpoint({ ...basis, FACTUMAI_MCP_MAIL_INSTANCE_KEY: leeg });
      expect(ep?.instanceKey).toBeUndefined();
    }
  });

  it('zet auth op het endpoint zoals de MCP het verwacht', () => {
    const ep = mailEndpoint({
      ...basis,
      CF_ACCESS_CLIENT_ID: 'id',
      CF_ACCESS_CLIENT_SECRET: 'secret',
    });
    expect(ep?.apiKey).toBe('geheim');
    expect(ep?.cfAccess).toEqual({
      'CF-Access-Client-Id': 'id',
      'CF-Access-Client-Secret': 'secret',
    });
  });
});

describe('auth-helpers', () => {
  it('geeft voorrang aan het inbound-secret boven de legacy sleutel', () => {
    expect(mcpBearer({ FACTUMAI_MCP_INBOUND_SECRET: 'nieuw', FACTUMAI_MCP_API_KEY: 'oud' })).toBe(
      'nieuw',
    );
    expect(mcpBearer({ FACTUMAI_MCP_API_KEY: 'oud' })).toBe('oud');
    expect(mcpBearer({})).toBeUndefined();
  });

  // Half ingevuld is erger dan niets: Access weigert dan aan de edge met 403,
  // en dat is een fout die niet op de MCP te zien is.
  it('stuurt Access-headers alleen als beide helften er zijn', () => {
    expect(cfAccessHeaders({ CF_ACCESS_CLIENT_ID: 'id' })).toEqual({});
    expect(cfAccessHeaders({ CF_ACCESS_CLIENT_SECRET: 'secret' })).toEqual({});
    expect(cfAccessHeaders({})).toEqual({});
  });
});
