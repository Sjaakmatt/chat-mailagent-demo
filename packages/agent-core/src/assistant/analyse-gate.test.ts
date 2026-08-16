import { describe, expect, it } from 'vitest';
import {
  evaluateAnalyseGate,
  isAggregationToolName,
  type McpClassificationReport,
} from './analyse-gate.js';

const TICKETS: McpClassificationReport = {
  mcp: 'factumai-mcp-tickets',
  volledigGeclassificeerd: true,
  ongeclassificeerdeTools: [],
  aggregatieTools: ['aggregate_complaint_rate', 'aggregate_resolution_time'],
};

const ERP_INCOMPLEET: McpClassificationReport = {
  mcp: 'factumai-mcp-erp',
  volledigGeclassificeerd: false,
  ongeclassificeerdeTools: ['get_stock_position', 'get_sku', 'create_invoice', 'get_installation'],
  aggregatieTools: [],
};

const ROLLEN_MET_ANALYSE = {
  viewer: ['operationeel'] as const,
  reviewer: ['operationeel'] as const,
  admin: ['operationeel', 'commercieel', 'financieel'] as const,
};

describe('evaluateAnalyseGate — de gate van stap 5', () => {
  it('zet de vlag aan als alle drie de voorwaarden zijn gehaald', () => {
    const result = evaluateAnalyseGate({
      reports: [TICKETS],
      categoriesPerRole: ROLLEN_MET_ANALYSE,
    });
    expect(result.mag).toBe(true);
    expect(result.redenen).toEqual([]);
  });

  it('gaat niet aan bij één ongeclassificeerd veld', () => {
    // Dit is de gate, letterlijk: één MCP die niet volledig is, houdt de hele
    // vlag tegen. Geen halve activering.
    const result = evaluateAnalyseGate({
      reports: [TICKETS, ERP_INCOMPLEET],
      categoriesPerRole: ROLLEN_MET_ANALYSE,
    });
    expect(result.mag).toBe(false);
    expect(result.velden.ok).toBe(false);
    // De andere twee zijn wél gehaald — dat mag de uitkomst niet redden.
    expect(result.aggregaties.ok).toBe(true);
    expect(result.rollen.ok).toBe(true);
  });

  it('noemt wát er mist, niet alleen dát er iets mist', () => {
    const result = evaluateAnalyseGate({
      reports: [TICKETS, ERP_INCOMPLEET],
      categoriesPerRole: ROLLEN_MET_ANALYSE,
    });
    // Anders begint degene die het moet oplossen met zoeken.
    expect(result.redenen[0]).toContain('factumai-mcp-erp');
    expect(result.redenen[0]).toContain('get_stock_position');
  });

  it('kort een lange lijst ontbrekende tools af met een telling', () => {
    const result = evaluateAnalyseGate({
      reports: [ERP_INCOMPLEET],
      categoriesPerRole: ROLLEN_MET_ANALYSE,
    });
    expect(result.redenen[0]).toContain('+1');
  });

  it('gaat niet aan zonder aggregatietool', () => {
    const result = evaluateAnalyseGate({
      reports: [{ ...TICKETS, aggregatieTools: [] }],
      categoriesPerRole: ROLLEN_MET_ANALYSE,
    });
    expect(result.mag).toBe(false);
    expect(result.aggregaties.ok).toBe(false);
    expect(result.redenen[0]).toContain('alleen weigeren');
  });

  it('gaat niet aan als niemand commercieel of financieel mag zien', () => {
    // Dan is er niemand voor wie de analyse-laag iets kan betekenen.
    const result = evaluateAnalyseGate({
      reports: [TICKETS],
      categoriesPerRole: {
        viewer: ['operationeel'],
        reviewer: ['operationeel'],
        admin: ['operationeel'],
      },
    });
    expect(result.mag).toBe(false);
    expect(result.rollen.ok).toBe(false);
  });

  it('heeft aan één rol met commercieel genoeg', () => {
    const result = evaluateAnalyseGate({
      reports: [TICKETS],
      categoriesPerRole: { reviewer: ['operationeel', 'commercieel'] },
    });
    expect(result.rollen.ok).toBe(true);
    expect(result.mag).toBe(true);
  });

  it('gaat niet aan als geen enkele MCP zich meldt', () => {
    // "We weten het niet" is geen "alles is in orde". Fail-closed.
    const result = evaluateAnalyseGate({
      reports: [],
      categoriesPerRole: ROLLEN_MET_ANALYSE,
    });
    expect(result.mag).toBe(false);
    expect(result.velden.ok).toBe(false);
    expect(result.aggregaties.ok).toBe(false);
  });

  it('verzamelt alle redenen, niet alleen de eerste', () => {
    // Wie drie dingen moet oplossen, wil ze in één keer zien.
    const result = evaluateAnalyseGate({
      reports: [ERP_INCOMPLEET],
      categoriesPerRole: { reviewer: ['operationeel'] },
    });
    expect(result.redenen).toHaveLength(3);
  });
});

describe('isAggregationToolName', () => {
  it('herkent een aggregatietool aan zijn naam', () => {
    expect(isAggregationToolName('aggregate_complaint_rate')).toBe(true);
    expect(isAggregationToolName('list_tickets')).toBe(false);
    expect(isAggregationToolName('get_aggregate_thing')).toBe(false);
  });
});
