import { describe, expect, it } from 'vitest';
import {
  adresVan,
  klantInzichtSource,
  perKlantSource,
  terugkerendSource,
  volumeSource,
  type InzichtRow,
} from './index.js';

const NU = new Date('2026-08-19T12:00:00Z');

function rij(p: Partial<InzichtRow> & { id: string }): InzichtRow {
  return {
    status: 'PENDING',
    category: null,
    created_at: '2026-08-19T09:00:00Z',
    from_address: null,
    subject: null,
    ...p,
  };
}

describe('adresVan', () => {
  it('haalt het adres uit een naam-kop', () => {
    expect(adresVan('Marieke van den Berg <M.VandenBerg@Example.com>')).toBe(
      'm.vandenberg@example.com',
    );
  });
  it('accepteert een kaal adres', () => {
    expect(adresVan('p.jansen@example.com')).toBe('p.jansen@example.com');
  });
  it('geeft null bij iets dat geen adres is', () => {
    expect(adresVan('Onbekende afzender')).toBeNull();
    expect(adresVan(null)).toBeNull();
  });
});

describe('volumeSource', () => {
  const rows = [
    rij({ id: 'a', created_at: '2026-08-19T08:00:00Z', category: 'klacht' }),
    rij({ id: 'b', created_at: '2026-08-19T09:30:00Z', category: 'levertijd_status' }),
    rij({ id: 'c', created_at: '2026-08-18T09:30:00Z', category: 'klacht', status: 'APPROVED' }),
  ];

  it('schrijft het aantal van vandaag letterlijk uit', () => {
    // Letterlijk, want de grounding-controle laat alleen getallen door die in
    // een bron staan. Een model dat zelf uit datums moet optellen, mag dat niet
    // en doet het toch.
    const t = volumeSource(rows, NU).text;
    expect(t).toContain('Vandaag (2026-08-19) binnengekomen: 2');
    expect(t).toContain('- 2026-08-18: 1');
  });

  it('telt per categorie en per status', () => {
    const t = volumeSource(rows, NU).text;
    expect(t).toContain('- klacht: 2');
    expect(t).toContain('- levertijd_status: 1');
    expect(t).toContain('- PENDING: 2');
    expect(t).toContain('- APPROVED: 1');
  });

  it('zet een nul neer op een dag zonder berichten', () => {
    expect(volumeSource(rows, NU).text).toContain('- 2026-08-17: 0');
  });
});

describe('perKlantSource', () => {
  const rows = [
    rij({ id: 'a', from_address: 'Klant <k@example.com>', category: 'klacht' }),
    rij({ id: 'b', from_address: 'k@example.com', category: 'klacht' }),
    rij({ id: 'c', from_address: 'k@example.com', category: 'levertijd_status' }),
    rij({ id: 'd', from_address: 'ander@example.com', category: 'product_vraag' }),
  ];

  it('telt klachten per klant', () => {
    const bron = perKlantSource(rows, [], ['klacht'])!;
    expect(bron.text).toContain('k@example.com');
    expect(bron.text).toContain('Berichten: 3');
    expect(bron.text).toContain('Waarvan klacht: 2');
  });

  it('laat zien hoe vaak dezelfde soort vraag terugkomt bij één klant', () => {
    const bron = perKlantSource(rows, [], ['klacht'])!;
    expect(bron.text).toContain('- klacht: 2');
  });

  it('telt tickets mee op e-mailadres', () => {
    const bron = perKlantSource(rows, [{ contactEmail: 'K@Example.com' }], ['klacht'])!;
    expect(bron.text).toContain('Tickets: 1');
  });

  it('geeft null als niemand een adres heeft', () => {
    expect(perKlantSource([rij({ id: 'x' })], [], [])).toBeNull();
  });
});

describe('terugkerendSource', () => {
  it('telt per categorie én het aantal klanten erachter', () => {
    const bron = terugkerendSource([
      rij({ id: 'a', category: 'levertijd_status', from_address: 'a@example.com' }),
      rij({ id: 'b', category: 'levertijd_status', from_address: 'b@example.com' }),
      rij({ id: 'c', category: 'levertijd_status', from_address: 'a@example.com' }),
    ])!;
    // Drie keer dezelfde vraag, maar van twee klanten. Dat verschil is precies
    // wat "komt dit vaker voor" moet beantwoorden.
    expect(bron.text).toContain('- levertijd_status: 3 keer, bij 2 klanten');
  });

  it('trekt ordernummers en Re: uit het onderwerp zodat een patroon zichtbaar wordt', () => {
    const bron = terugkerendSource([
      rij({ id: 'a', subject: 'Waar blijft mijn bestelling DEMO-1001' }),
      rij({ id: 'b', subject: 'Re: Waar blijft mijn bestelling DEMO-1004' }),
    ])!;
    expect(bron.text).toContain('"waar blijft mijn bestelling …": 2 keer');
  });

  it('zwijgt netjes als niets terugkomt', () => {
    const bron = terugkerendSource([rij({ id: 'a', subject: 'Eenmalig' })])!;
    expect(bron.text).toContain('geen onderwerp komt vaker dan eens voor');
  });
});

describe('klantInzichtSource', () => {
  const rows = [
    rij({ id: 'nu', from_address: 'k@example.com', category: 'klacht', subject: 'Derde keer' }),
    rij({ id: 'oud', from_address: 'k@example.com', category: 'klacht', created_at: '2026-07-01T09:00:00Z' }),
    rij({ id: 'ander', from_address: 'x@example.com', category: 'klacht' }),
  ];

  it('telt alleen deze klant en markeert het huidige bericht', () => {
    const bron = klantInzichtSource(rows, 'K@example.com', 'nu')!;
    expect(bron.text).toContain('Berichten in totaal: 2');
    expect(bron.text).toContain('Waarvan eerder dan dit bericht: 1');
    expect(bron.text).toContain('← dit bericht');
  });

  it('geeft null bij een afzender zonder adres', () => {
    expect(klantInzichtSource(rows, 'Onbekend', 'nu')).toBeNull();
  });
});
