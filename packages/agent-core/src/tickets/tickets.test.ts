import { describe, it, expect } from 'vitest';
import {
  normalizeTicketPrefix,
  ticketPeriod,
  formatTicketNumber,
  findTicketNumber,
  ticketReadiness,
  confirmationText,
  canTransition,
  CONFIRMATION,
  DEFAULT_TICKET_PREFIX,
  type TicketStatus,
} from './index.js';

describe('ticketnummer', () => {
  it('bouwt PREFIX-JJMM-NNNN', () => {
    expect(formatTicketNumber('PRO', '2608', 42)).toBe('PRO-2608-0042');
  });

  it('leidt de periode af in UTC', () => {
    expect(ticketPeriod(new Date('2026-08-17T10:00:00Z'))).toBe('2608');
    expect(ticketPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('2601');
    expect(ticketPeriod(new Date('2030-12-31T23:59:59Z'))).toBe('3012');
  });

  it('loopt door boven de vier cijfers in plaats van te botsen', () => {
    expect(formatTicketNumber('PRO', '2608', 12345)).toBe('PRO-2608-12345');
  });

  it('normaliseert een rommelige prefix', () => {
    expect(normalizeTicketPrefix('pro')).toBe('PRO');
    expect(normalizeTicketPrefix('Pro-Fa')).toBe('PRO');
    expect(normalizeTicketPrefix('p')).toBe(DEFAULT_TICKET_PREFIX);
    expect(normalizeTicketPrefix('')).toBe(DEFAULT_TICKET_PREFIX);
    expect(normalizeTicketPrefix(null)).toBe(DEFAULT_TICKET_PREFIX);
    expect(normalizeTicketPrefix('123')).toBe(DEFAULT_TICKET_PREFIX);
  });
});

describe('een ticketnummer terugvinden in een bericht', () => {
  it('vindt het nummer in een lopende zin', () => {
    expect(findTicketNumber('Ik bel over PRO-2608-0042, is er al nieuws?')).toBe('PRO-2608-0042');
  });

  it('vindt het ongeacht hoofdletters', () => {
    expect(findTicketNumber('mijn ticket pro-2608-0042')).toBe('PRO-2608-0042');
  });

  it('vindt niets als er geen nummer staat', () => {
    expect(findTicketNumber('Waar blijft mijn pakket?')).toBeNull();
    expect(findTicketNumber('order DEMO-1001')).toBeNull();
    expect(findTicketNumber('')).toBeNull();
  });
});

describe('is er genoeg voor een ticket', () => {
  it('compleet met adres én ordernummer', () => {
    const r = ticketReadiness({ contactEmail: 'k@example.com', orderReference: 'DEMO-1001' });
    expect(r.state).toBe('complete');
  });

  // Het mailadres is de harde eis: zonder terugkoppelkanaal heeft een ticket
  // geen zin, want de chatbezoeker is weg zodra hij het venster sluit.
  it('gedeeltelijk met alleen een adres — wel een ticket, met notitie', () => {
    const r = ticketReadiness({ contactEmail: 'k@example.com' });
    expect(r.state).toBe('partial');
    if (r.state === 'partial') expect(r.note).toContain('ordernummer');
  });

  it('onvoldoende zonder adres — géén ticket', () => {
    const r = ticketReadiness({ orderReference: 'DEMO-1001' });
    expect(r.state).toBe('insufficient');
    if (r.state === 'insufficient') expect(r.missing).toContain('contactEmail');
  });

  it('onvoldoende bij een adres dat geen adres is', () => {
    expect(ticketReadiness({ contactEmail: 'geen adres' }).state).toBe('insufficient');
    expect(ticketReadiness({ contactEmail: '  ' }).state).toBe('insufficient');
    expect(ticketReadiness({}).state).toBe('insufficient');
  });

  it('trimt witruimte voor het oordeel', () => {
    const r = ticketReadiness({ contactEmail: '  k@example.com  ', orderReference: ' DEMO-1 ' });
    expect(r.state).toBe('complete');
    if (r.state === 'complete') {
      expect(r.contactEmail).toBe('k@example.com');
      expect(r.orderReference).toBe('DEMO-1');
    }
  });
});

describe('bevestigingstekst', () => {
  it('vult het nummer in', () => {
    expect(confirmationText('PRO-2608-0042')).toContain('PRO-2608-0042');
  });

  // Een bevestiging zonder nummer is waardeloos — dan plakken we 'm erachter
  // in plaats van 'm stil te laten verdwijnen.
  it('plakt het nummer erachter als de template de placeholder mist', () => {
    const tekst = confirmationText('PRO-2608-0042', {
      template: 'We pakken het op.',
      needsIdentityText: '',
    });
    expect(tekst).toContain('PRO-2608-0042');
  });

  it('zet de reden van de beleidsregel in de tekst', () => {
    const tekst = confirmationText(
      'PRO-2608-0042',
      CONFIRMATION,
      'Een wijziging op een lopende bestelling bevestigen we altijd met een collega.',
    );
    expect(tekst).toContain('lopende bestelling bevestigen we altijd met een collega');
    expect(tekst).toContain('PRO-2608-0042');
    // De generieke zin hoort dan wég te zijn, niet erbij.
    expect(tekst).not.toContain(CONFIRMATION.defaultHandoverReason);
  });

  it('valt terug op de generieke reden als de regel er geen heeft', () => {
    for (const leeg of [undefined, null, '', '   ']) {
      expect(confirmationText('PRO-2608-0042', CONFIRMATION, leeg)).toContain(
        CONFIRMATION.defaultHandoverReason,
      );
    }
  });

  // Deze tekst gaat rechtstreeks naar een klant. Een config van vóór `{reason}`
  // mag daar nooit het woord "undefined" in achterlaten.
  it('schrijft nooit "undefined" bij een config zonder terugvalreden', () => {
    const tekst = confirmationText('PRO-2608-0042', {
      template: '{reason} Ticket {number}.',
      needsIdentityText: '',
    } as unknown as typeof CONFIRMATION);
    expect(tekst).not.toContain('undefined');
    expect(tekst).toContain('PRO-2608-0042');
  });

  it('belooft standaard geen doorlooptijd', () => {
    expect(CONFIRMATION.template).not.toMatch(/\b\d+\s*(werk)?dag/i);
    expect(CONFIRMATION.template).not.toMatch(/binnen \d/i);
  });

  it('vraagt bij ontbrekende identificatie om het adres', () => {
    expect(CONFIRMATION.needsIdentityText).toContain('e-mailadres');
  });
});

describe('statusovergangen', () => {
  it('staat de gewone gang toe', () => {
    expect(canTransition('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'DONE')).toBe(true);
  });

  it('laat loslaten en heropenen toe', () => {
    expect(canTransition('IN_PROGRESS', 'OPEN')).toBe(true);
    // Een klant kan terugkomen op iets dat afgehandeld leek.
    expect(canTransition('DONE', 'OPEN')).toBe(true);
  });

  it('houdt CANCELLED als eindpunt', () => {
    for (const to of ['OPEN', 'IN_PROGRESS', 'DONE'] as TicketStatus[]) {
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('staat geen sprong van DONE naar IN_PROGRESS toe', () => {
    expect(canTransition('DONE', 'IN_PROGRESS')).toBe(false);
  });
});
