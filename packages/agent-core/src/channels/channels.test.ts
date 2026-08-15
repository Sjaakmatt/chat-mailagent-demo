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
  it('heeft mail en chat als actieve kanalen', () => {
    expect(CHANNELS.map((c) => c.id)).toEqual(['mail', 'chat']);
  });

  it('resolvet mail op ReviewItem-soort en op domein', () => {
    expect(channelForKind('draft_email')).toBe(MAIL_CHANNEL);
    expect(channelForDomain('mail')).toBe(MAIL_CHANNEL);
  });

  it('resolvet chat op soort en domein', () => {
    expect(channelForKind(CHAT_CHANNEL.reviewItemKind)).toBe(CHAT_CHANNEL);
    expect(channelForDomain('chat')).toBe(CHAT_CHANNEL);
  });

  it('markeert chat als realtime en mail niet', () => {
    expect(CHAT_CHANNEL.realtime).toBe(true);
    expect(MAIL_CHANNEL.realtime).toBe(false);
  });

  it('kent een kanaal dat niet geregistreerd is niet', () => {
    expect(channelForDomain('telefonie')).toBeUndefined();
  });

  it('herkent alleen signal-types van actieve kanalen', () => {
    expect(isSupportedSignalType('mail.received')).toBe(true);
    expect(isSupportedSignalType('chat.message')).toBe(true);
    expect(isSupportedSignalType('onzin.type')).toBe(false);
  });
});
