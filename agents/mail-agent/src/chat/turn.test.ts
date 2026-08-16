import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewItem, OutcomeDecision } from '@factumai/agent-core';
import { CONFIRMATION, DOMAIN } from '@factumai/agent-core';

// De bezorging en het ticket-aanmaken raken de database; hier gaat het om de
// beslissing wát de bezoeker krijgt, niet om het transport.
const pushed: string[] = [];
const createdTickets: unknown[] = [];
let ticketAnswer: { id: string; number: string; confirmation: string } | null = null;

vi.mock('./delivery.js', () => ({
  deliverChatReply: vi.fn(async (_env: unknown, item: { proposed: { body?: string } }) => {
    pushed.push(item.proposed.body ?? '');
    return { ref: 'x' };
  }),
}));

vi.mock('./tickets.js', () => ({
  createTicket: vi.fn(async (_env: unknown, input: unknown) => {
    createdTickets.push(input);
    return ticketAnswer;
  }),
}));

const { finishChatTurn } = await import('./turn.js');

const env = {} as never;

function item(body: string, original: Record<string, unknown> = {}): ReviewItem {
  return {
    id: 'ri_1',
    organizationId: 'org-demo',
    signalId: 'sig_1',
    kind: 'draft_chat_reply',
    summary: 'Vraag van een bezoeker',
    proposed: { body, original },
    status: 'PENDING',
    createdAt: '2026-08-17T10:00:00Z',
  };
}

const uitkomst = (o: string): OutcomeDecision =>
  ({ outcome: o, reason: 'test' }) as OutcomeDecision;

beforeEach(() => {
  pushed.length = 0;
  createdTickets.length = 0;
  ticketAnswer = { id: 'tic_1', number: 'TIC-2608-0001', confirmation: 'Ticket TIC-2608-0001.' };
});

describe('wat de bezoeker terugkrijgt', () => {
  it('buiten domein: de vaste afwijzingstekst, niets van de bezoeker', async () => {
    const res = await finishChatTurn(env, item(DOMAIN.rejectionText), undefined, {
      outOfDomain: true,
      conversationId: 'conv_1',
    });
    expect(res?.reply).toBe(DOMAIN.rejectionText);
    expect(pushed).toEqual([DOMAIN.rejectionText]);
    expect(createdTickets).toHaveLength(0);
  });

  it.each(['kennis', 'systeem'])('%s: het opgestelde antwoord gaat direct uit', async (o) => {
    const res = await finishChatTurn(env, item('Je pakket komt morgen.'), uitkomst(o), {
      conversationId: 'conv_1',
    });
    expect(res?.reply).toBe('Je pakket komt morgen.');
    expect(pushed).toEqual(['Je pakket komt morgen.']);
    expect(createdTickets).toHaveLength(0);
  });

  // De kern: bij taak gaat het inhoudelijke antwoord NIET naar de bezoeker.
  // Anders belooft de agent iets wat een mens nog moet waarmaken.
  it('taak: ticket plus bevestiging, niet het opgestelde antwoord', async () => {
    const res = await finishChatTurn(
      env,
      item('Ik zeg je abonnement meteen op.', { from: 'k@example.com', orderNumber: 'DEMO-1' }),
      uitkomst('taak'),
      { conversationId: 'conv_1', category: 'opzegging_proef' },
    );
    expect(res?.ticketNumber).toBe('TIC-2608-0001');
    expect(pushed).toEqual(['Ticket TIC-2608-0001.']);
    expect(pushed[0]).not.toContain('zeg je abonnement');
  });

  // De reden waarom er een mens aan te pas komt, komt uit de beleidsregel en
  // staat onder `proposed.policy` — niet op het ReviewItem zelf. Dat is precies
  // het soort verschil waar dit stil op de generieke zin zou terugvallen.
  it('taak: geeft de reden uit de beleidsregel door aan het ticket', async () => {
    const ri = item('Concept voor de collega.', {
      from: 'k@example.com',
      orderNumber: 'DEMO-1',
    });
    (ri.proposed as Record<string, unknown>).policy = {
      ruleId: 'rule_1',
      ruleName: 'Abonnement wijzigen',
      handoverReason: 'Een wijziging bevestigen we altijd met een collega.',
    };

    await finishChatTurn(env, ri, uitkomst('taak'), {
      conversationId: 'conv_1',
      category: 'order_wijziging',
    });

    expect(createdTickets[0]).toMatchObject({
      handoverReason: 'Een wijziging bevestigen we altijd met een collega.',
    });
  });

  it('taak zonder beleidsregel: geen reden, dan pakt de tekst de terugval', async () => {
    await finishChatTurn(
      env,
      item('Concept.', { from: 'k@example.com', orderNumber: 'DEMO-1' }),
      uitkomst('taak'),
      { conversationId: 'conv_1', category: 'overig' },
    );
    expect(createdTickets[0]).toMatchObject({ handoverReason: null });
  });

  it('taak zonder bruikbare identificatie: om gegevens vragen, geen ticket', async () => {
    ticketAnswer = null;
    const res = await finishChatTurn(env, item('Ik regel het.'), uitkomst('taak'), {
      conversationId: 'conv_1',
    });
    expect(res?.reply).toBe(CONFIRMATION.needsIdentityText);
    expect(res?.ticketNumber).toBeUndefined();
    expect(pushed).toEqual([CONFIRMATION.needsIdentityText]);
  });

  it('onbekend: doorvragen, en géén ticket', async () => {
    const res = await finishChatTurn(env, item('Bedoel je je laatste bestelling?'), uitkomst('onbekend'), {
      conversationId: 'conv_1',
    });
    expect(res?.reply).toBe('Bedoel je je laatste bestelling?');
    expect(createdTickets).toHaveLength(0);
  });

  it('stuurt niets bij een lege body', async () => {
    expect(await finishChatTurn(env, item('   '), uitkomst('kennis'), { conversationId: 'c' })).toBeNull();
    expect(await finishChatTurn(env, item(''), uitkomst('onbekend'), { conversationId: 'c' })).toBeNull();
    expect(pushed).toEqual([]);
  });

  // Zonder uitkomst is `taak` de veilige aanname: liever een ticket dan een
  // ongecontroleerd antwoord.
  it('valt zonder uitkomst terug op taak', async () => {
    await finishChatTurn(env, item('Iets'), undefined, {
      conversationId: 'conv_1',
    });
    expect(createdTickets).toHaveLength(1);
  });

  // De drie fouten uit het gesprek van 15:01, elk apart vastgelegd.
  it('vraagt alleen om het mailadres als het ordernummer al bekend is', async () => {
    ticketAnswer = null;
    const res = await finishChatTurn(
      env,
      {
        ...item('Ik zoek het op.', {}),
        proposed: {
          body: 'Ik zoek het op.',
          original: {},
          classification: { extracted: { orderNumber: 'DEMO-1001' } },
        },
      },
      uitkomst('taak'),
      { conversationId: 'conv_1', category: 'levertijd_status' },
    );
    expect(res?.reply).toContain('ordernummer heb ik');
    expect(res?.reply).not.toBe(CONFIRMATION.needsIdentityText);
  });

  it('vraagt alleen om het ordernummer als het mailadres al bekend is', async () => {
    ticketAnswer = null;
    const res = await finishChatTurn(
      env,
      {
        ...item('Ik zoek het op.', {}),
        proposed: {
          body: 'Ik zoek het op.',
          original: { from: 'k@example.com' },
          classification: { extracted: {} },
        },
      },
      uitkomst('taak'),
      { conversationId: 'conv_1', category: 'levertijd_status' },
    );
    expect(res?.reply).toContain('mailadres heb ik');
  });

  it('vraagt om allebei als er niets bekend is', async () => {
    ticketAnswer = null;
    const res = await finishChatTurn(
      env,
      {
        ...item('Ik zoek het op.', {}),
        proposed: { body: 'Ik zoek het op.', original: {}, classification: { extracted: {} } },
      },
      uitkomst('taak'),
      { conversationId: 'conv_1', category: 'levertijd_status' },
    );
    expect(res?.reply).toBe(CONFIRMATION.needsIdentityText);
  });
});
