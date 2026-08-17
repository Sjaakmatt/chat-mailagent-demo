import { describe, it, expect } from 'vitest';
import {
  CHANNELS,
  MAIL_CHANNEL,
  CHAT_CHANNEL,
  channelForKind,
  channelForDomain,
  isSupportedSignalType,
  kindsHandledOutsideWorkbench,
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

  it('houdt mail in de werkbak en chat eruit', () => {
    expect(MAIL_CHANNEL.queuesForReview).toBe(true);
    expect(CHAT_CHANNEL.queuesForReview).toBe(false);
    expect(kindsHandledOutsideWorkbench()).toEqual([CHAT_CHANNEL.reviewItemKind]);
  });

  it('sluit alleen kanalen uit, niet de soorten van modules', () => {
    // De lijst is een uitsluitlijst. Een module die z'n eigen ReviewItem-soort
    // produceert (magazijnbon, factuurvoorstel) hoort gewoon in de werkbak en
    // hoeft zich nergens te melden — zou dit een toelatingslijst worden, dan
    // begint elke nieuwe automatisering onzichtbaar.
    expect(kindsHandledOutsideWorkbench()).not.toContain('draft_email');
    expect(kindsHandledOutsideWorkbench()).not.toContain('warehouse_task');
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
