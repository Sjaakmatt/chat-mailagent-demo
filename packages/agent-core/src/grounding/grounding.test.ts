import { describe, it, expect } from 'vitest';
import {
  ToolCallRecorder,
  validateGrounding,
  extractNumericTokens,
} from './index.js';

describe('extractNumericTokens', () => {
  it('vindt bedragen, aantallen en track&trace-codes', () => {
    const tokens = extractNumericTokens('Je 2 panelen, totaal € 1.299,00, code 3SABC123.');
    expect(tokens).toContain('2');
    expect(tokens).toContain('1.299,00');
    expect(tokens).toContain('3SABC123');
  });

  it('dedupliceert', () => {
    expect(extractNumericTokens('order 42 en nog eens 42')).toEqual(['42']);
  });
});

describe('validateGrounding', () => {
  it('grondt claims die naar een echte tool-call verwijzen', () => {
    const recorder = new ToolCallRecorder();
    recorder.record({ toolCallId: 'tc1', tool: 'erp.get_order_tracking' });

    const res = validateGrounding(
      'Je pakket met code 3SABC123 is onderweg.',
      [{ value: '3SABC123', toolCallId: 'tc1' }],
      recorder,
    );

    expect(res.grounding).toEqual([
      { claim: '3SABC123', toolCallId: 'tc1', tool: 'erp.get_order_tracking' },
    ]);
    expect(res.ungrounded).toEqual([]);
  });

  it('markeert een getal zonder dekkende tool-call als ungrounded', () => {
    const recorder = new ToolCallRecorder();
    const res = validateGrounding(
      'Er liggen 7 panelen klaar.',
      [],
      recorder,
    );
    expect(res.grounding).toEqual([]);
    expect(res.ungrounded).toContain('7');
  });

  it('telt een verzonnen ref (onbekende toolCallId) niet als grounding', () => {
    const recorder = new ToolCallRecorder();
    const res = validateGrounding(
      'Bedrag is 500 euro.',
      [{ value: '500', toolCallId: 'verzonnen' }],
      recorder,
    );
    expect(res.grounding).toEqual([]);
    expect(res.ungrounded).toContain('500');
  });
});
