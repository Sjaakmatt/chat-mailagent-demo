import { describe, expect, it } from 'vitest';
import {
  aggregationSource,
  buildAnalysePlanPrompt,
  finalizeAssistantAnswer,
  parseAnalysePlan,
  resolveAnalysePlan,
  type AggregationCatalogEntry,
  type AggregationSummary,
} from './index.js';

const CATALOG: AggregationCatalogEntry[] = [
  {
    tool: 'aggregate_complaint_rate',
    mcp: 'factumai-mcp-tickets',
    omschrijving: 'Welk deel van de tickets in een periode een klacht is',
    extraArgumenten: { labelFilter: 'reken alleen over tickets met dit label' },
  },
  {
    tool: 'aggregate_resolution_time',
    mcp: 'factumai-mcp-tickets',
    omschrijving: 'Gemiddelde doorlooptijd van opgeloste tickets in dagen',
  },
];

const JULI = { van: '2026-07-01', tot: '2026-08-01' };
const json = (o: unknown) => JSON.stringify(o);

describe('parseAnalysePlan', () => {
  it('leest een keuze met periode', () => {
    const plan = parseAnalysePlan(
      json({ tool: 'aggregate_complaint_rate', args: JULI, cannotAnswer: null }),
    );
    expect(plan?.tool).toBe('aggregate_complaint_rate');
    expect(plan?.args).toEqual(JULI);
  });

  it('leest een weigering van het model zelf', () => {
    const plan = parseAnalysePlan(json({ tool: null, args: null, cannotAnswer: 'geen marge-tool' }));
    expect(plan?.cannotAnswer).toBe('geen marge-tool');
  });

  it('geeft null bij onleesbare output', () => {
    expect(parseAnalysePlan('geen idee')).toBeNull();
  });
});

describe('resolveAnalysePlan — de tweede helft van de gate', () => {
  it('laat een aggregatie uit de catalogus door', () => {
    const plan = resolveAnalysePlan(
      { tool: 'aggregate_complaint_rate', args: JULI },
      CATALOG,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mcp).toBe('factumai-mcp-tickets');
  });

  it('weigert een aggregatie die niet bestaat, en benadert hem niet', () => {
    // Dit is de gate: geen schatting, en niet stiekem de doorlooptijd pakken
    // omdat die er wél is.
    const plan = resolveAnalysePlan(
      { tool: 'aggregate_profit_margin', args: JULI },
      CATALOG,
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reden).toContain('bestaat hier niet');
    expect(plan.reden).toContain('benader hem niet');
  });

  it('geeft de weigering van het model door in plaats van er overheen te gaan', () => {
    const plan = resolveAnalysePlan(
      { cannotAnswer: 'Er is geen aggregatie voor marges.' },
      CATALOG,
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reden).toBe('Er is geen aggregatie voor marges.');
  });

  it('weigert zonder periode — een cijfer zonder periode zegt niets', () => {
    const plan = resolveAnalysePlan({ tool: 'aggregate_complaint_rate', args: {} }, CATALOG);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reden).toContain('periode');
  });

  it('weigert een halve periode', () => {
    const plan = resolveAnalysePlan(
      { tool: 'aggregate_complaint_rate', args: { van: '2026-07-01' } },
      CATALOG,
    );
    expect(plan.ok).toBe(false);
  });

  it('weigert bij onleesbare modeloutput', () => {
    const plan = resolveAnalysePlan(null, CATALOG);
    expect(plan.ok).toBe(false);
  });

  it('weigert alles zodra de catalogus leeg is', () => {
    const plan = resolveAnalysePlan({ tool: 'aggregate_complaint_rate', args: JULI }, []);
    expect(plan.ok).toBe(false);
  });
});

describe('buildAnalysePlanPrompt', () => {
  it('zet de catalogus, de extra argumenten en de datum erin', () => {
    const [system, user] = buildAnalysePlanPrompt(
      'Hoeveel klachten hadden we in juli?',
      CATALOG,
      '2026-08-16',
    );
    expect(system?.content).toContain('rekent NIET');
    expect(user?.content).toContain('aggregate_complaint_rate');
    expect(user?.content).toContain('labelFilter');
    expect(user?.content).toContain('2026-08-16');
  });

  it('meldt een lege catalogus in plaats van een lege lijst te sturen', () => {
    const [, user] = buildAnalysePlanPrompt('x', [], '2026-08-16');
    expect(user?.content).toContain('geen aggregaties beschikbaar');
  });
});

describe('aggregationSource', () => {
  const RESULT: AggregationSummary = {
    waarde: 30,
    eenheid: 'percentage',
    periode: JULI,
    populatie: 10,
    definitie: '3 van 10 tickets; een klacht is een ticket met label klacht',
    uitgesloten: [{ aantal: 1, reden: 'geen aanmaakdatum' }],
    queryId: 'call-abc',
  };

  it('zet alle zeven velden in de brontekst', () => {
    // Niet netjesheid: de grounding-controle dekt een getal alleen als het
    // letterlijk in een bron voorkomt. Zou hier alleen de waarde staan, dan
    // mocht de assistent de populatie niet noemen — precies het cijfer dat het
    // percentage controleerbaar maakt.
    const source = aggregationSource('aggregate_complaint_rate', RESULT);
    for (const stuk of ['30', 'percentage', '2026-07-01', '2026-08-01', '10', 'call-abc']) {
      expect(source.text).toContain(stuk);
    }
    expect(source.text).toContain('geen aanmaakdatum');
  });

  it('laat een antwoord mét populatie en periode door de grounding-controle', () => {
    const source = aggregationSource('aggregate_complaint_rate', RESULT);
    const result = finalizeAssistantAnswer(
      {
        answer: 'In juli was 30 procent van de 10 tickets een klacht.',
        claims: [{ statement: '30 procent', sourceId: source.id }],
      },
      [source],
    );
    expect(result.ok).toBe(true);
  });

  it('houdt een antwoord tegen met een getal dat niet uit de aggregatie komt', () => {
    const source = aggregationSource('aggregate_complaint_rate', RESULT);
    const result = finalizeAssistantAnswer(
      { answer: 'Dat is 12 procentpunt hoger dan vorige maand.', claims: [] },
      [source],
    );
    expect(result.ok).toBe(false);
  });

  it('meldt expliciet als er niets is uitgesloten', () => {
    const source = aggregationSource('x', { ...RESULT, uitgesloten: [] });
    expect(source.text).toContain('niets uitgesloten');
  });
});
