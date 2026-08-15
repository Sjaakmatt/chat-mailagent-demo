import { describe, it, expect } from 'vitest';
import {
  finalizeOutcome,
  isIdentified,
  identificationPolicy,
  routingFor,
  mayRespondWithoutHuman,
  outcomeFromClassification,
  isOutcome,
  OUTCOME_ROUTING,
  type Outcome,
} from './index.js';

describe('degradatie van systeem naar taak', () => {
  it('houdt systeem overeind bij identificatie én een systeemantwoord', () => {
    const res = finalizeOutcome('systeem', { identified: true, systemAnswer: true });
    expect(res.outcome).toBe('systeem');
    expect(res.degradedFrom).toBeUndefined();
  });

  it('degradeert zonder identificatie', () => {
    const res = finalizeOutcome('systeem', { identified: false, systemAnswer: true });
    expect(res.outcome).toBe('taak');
    expect(res.degradedFrom).toBe('systeem');
    expect(res.reason).toContain('identificatie');
  });

  // Dit is de belangrijkste: een geslaagde call die niets vond, mag geen
  // antwoord opleveren. Anders verzint de agent een leverdatum.
  it('degradeert als er geen systeemantwoord terugkwam', () => {
    const res = finalizeOutcome('systeem', { identified: true, systemAnswer: false });
    expect(res.outcome).toBe('taak');
    expect(res.degradedFrom).toBe('systeem');
    expect(res.reason).toContain('niet gokken');
  });

  it('degradeert als beide ontbreken', () => {
    const res = finalizeOutcome('systeem', { identified: false, systemAnswer: false });
    expect(res.outcome).toBe('taak');
  });

  it.each<Outcome>(['kennis', 'taak', 'onbekend'])(
    'laat %s ongemoeid, ongeacht het bewijs',
    (uitkomst) => {
      for (const identified of [true, false]) {
        for (const systemAnswer of [true, false]) {
          const res = finalizeOutcome(uitkomst, { identified, systemAnswer });
          expect(res.outcome).toBe(uitkomst);
          expect(res.degradedFrom).toBeUndefined();
        }
      }
    },
  );

  it('een gedegradeerde uitkomst degradeert niet nog een keer', () => {
    const eerst = finalizeOutcome('systeem', { identified: false, systemAnswer: false });
    const nogmaals = finalizeOutcome(eerst.outcome, { identified: false, systemAnswer: false });
    expect(nogmaals.outcome).toBe('taak');
    expect(nogmaals.degradedFrom).toBeUndefined();
  });
});

describe('identificatie per kanaal', () => {
  it('mail: het afzenderadres volstaat', () => {
    expect(isIdentified('mail', { senderAddress: 'klant@example.com' })).toBe(true);
  });

  it('mail: zonder adres en zonder ordernummer niet', () => {
    expect(isIdentified('mail', {})).toBe(false);
    expect(isIdentified('mail', { senderAddress: '   ' })).toBe(false);
  });

  it('chat: een adres alleen is niet genoeg', () => {
    expect(isIdentified('chat', { senderAddress: 'klant@example.com' })).toBe(false);
  });

  it('chat: adres én ordernummer wel', () => {
    expect(
      isIdentified('chat', { senderAddress: 'klant@example.com', orderReference: 'DEMO-1001' }),
    ).toBe(true);
  });

  it('chat: een ordernummer alleen is niet genoeg', () => {
    expect(isIdentified('chat', { orderReference: 'DEMO-1001' })).toBe(false);
  });

  // Een nieuw kanaal mag nooit stilzwijgend soepeler zijn dan chat.
  it('onbekend kanaal krijgt het strengste beleid', () => {
    const policy = identificationPolicy('telefonie');
    expect(policy.senderAddressSuffices).toBe(false);
    expect(policy.requiresOrderReference).toBe(true);
    expect(isIdentified('telefonie', { senderAddress: 'x@example.com' })).toBe(false);
  });
});

describe('wat een uitkomst betekent voor de route', () => {
  it('onbekend wordt géén ticket maar een wedervraag', () => {
    const r = routingFor('onbekend');
    expect(r.createsTicket).toBe(false);
    expect(r.asksFollowUp).toBe(true);
    expect(r.mayAutoRespond).toBe(false);
  });

  it('taak wordt een ticket en gaat nooit automatisch', () => {
    const r = routingFor('taak');
    expect(r.createsTicket).toBe(true);
    expect(r.mayAutoRespond).toBe(false);
  });

  it('kennis en systeem mogen automatisch en maken geen ticket', () => {
    for (const o of ['kennis', 'systeem'] as const) {
      expect(routingFor(o).mayAutoRespond).toBe(true);
      expect(routingFor(o).createsTicket).toBe(false);
    }
  });

  it('precies één uitkomst maakt een ticket', () => {
    const met = Object.entries(OUTCOME_ROUTING).filter(([, r]) => r.createsTicket);
    expect(met.map(([k]) => k)).toEqual(['taak']);
  });
});

describe('mag de agent zelf antwoorden', () => {
  // Harde regel 1 uit CLAUDE.md: bij mail gaat er nooit iets autonoom uit,
  // ook geen kennisantwoord.
  it.each<Outcome>(['kennis', 'systeem', 'taak', 'onbekend'])(
    'mail: nooit zonder mens, ook niet bij %s',
    (uitkomst) => {
      expect(mayRespondWithoutHuman('mail', uitkomst)).toBe(false);
    },
  );

  it('chat: kennis en systeem mogen direct', () => {
    expect(mayRespondWithoutHuman('chat', 'kennis')).toBe(true);
    expect(mayRespondWithoutHuman('chat', 'systeem')).toBe(true);
  });

  it('chat: taak en onbekend nooit direct', () => {
    expect(mayRespondWithoutHuman('chat', 'taak')).toBe(false);
    expect(mayRespondWithoutHuman('chat', 'onbekend')).toBe(false);
  });

  // De volledige keten: een chat-statusvraag zonder ordernummer mag niet
  // automatisch beantwoord worden, hoe zeker de router ook was.
  it('chat-statusvraag zonder ordernummer belandt bij een mens', () => {
    const identified = isIdentified('chat', { senderAddress: 'klant@example.com' });
    const beslissing = finalizeOutcome('systeem', { identified, systemAnswer: true });
    expect(beslissing.outcome).toBe('taak');
    expect(mayRespondWithoutHuman('chat', beslissing.outcome)).toBe(false);
  });
});

describe('terugval als de router geen uitkomst noemt', () => {
  it('simple_reply met ordernummer wordt systeem', () => {
    expect(
      outcomeFromClassification({ specialist: 'simple_reply', extracted: { orderNumber: 'DEMO-1001' } }),
    ).toBe('systeem');
  });

  it('simple_reply zonder ordernummer wordt kennis', () => {
    expect(outcomeFromClassification({ specialist: 'simple_reply', extracted: {} })).toBe('kennis');
    expect(
      outcomeFromClassification({ specialist: 'simple_reply', extracted: { orderNumber: '  ' } }),
    ).toBe('kennis');
  });

  it('escalate wordt onbekend, niet taak', () => {
    // De router kon niet classificeren → doorvragen, geen ticket aanmaken.
    expect(outcomeFromClassification({ specialist: 'escalate' })).toBe('onbekend');
  });

  it.each(['order_change', 'complaint', 'technical', 'gdpr'])('%s wordt taak', (s) => {
    expect(outcomeFromClassification({ specialist: s })).toBe('taak');
  });

  it('onbekende of ontbrekende specialist wordt taak, niet automatisch', () => {
    expect(outcomeFromClassification({ specialist: 'iets_nieuws' })).toBe('taak');
    expect(outcomeFromClassification({})).toBe('taak');
  });

  it('valideert de vier waarden', () => {
    expect(isOutcome('kennis')).toBe(true);
    expect(isOutcome('taak')).toBe(true);
    expect(isOutcome('Systeem')).toBe(false);
    expect(isOutcome('')).toBe(false);
    expect(isOutcome(null)).toBe(false);
  });
});
