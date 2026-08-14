import { describe, it, expect } from 'vitest';
import {
  CHANNELS,
  MAIL_CHANNEL,
  CHAT_CHANNEL,
  channelForKind,
  channelForDomain,
  isSupportedSignalType,
} from './index.js';

describe('kanaal-registry', () => {
  it('heeft mail als enig actief kanaal in het fundament', () => {
    expect(CHANNELS.map((c) => c.id)).toEqual(['mail']);
  });

  it('resolvet mail op ReviewItem-soort en op domein', () => {
    expect(channelForKind('draft_email')).toBe(MAIL_CHANNEL);
    expect(channelForDomain('mail')).toBe(MAIL_CHANNEL);
  });

  it('kent een niet-geregistreerd kanaal niet', () => {
    // CHAT_CHANNEL bestaat als blauwdruk maar staat bewust niet in CHANNELS —
    // registreren is een expliciete keuze, geen bijwerking van importeren.
    expect(CHANNELS).not.toContain(CHAT_CHANNEL);
    expect(channelForKind(CHAT_CHANNEL.reviewItemKind)).toBeUndefined();
    expect(channelForDomain('chat')).toBeUndefined();
  });

  it('herkent alleen signal-types van actieve kanalen', () => {
    expect(isSupportedSignalType('mail.received')).toBe(true);
    expect(isSupportedSignalType('chat.message')).toBe(false);
    expect(isSupportedSignalType('onzin.type')).toBe(false);
  });
});
