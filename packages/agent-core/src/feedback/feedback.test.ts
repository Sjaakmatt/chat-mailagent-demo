import { describe, it, expect } from 'vitest';
import { buildFeedbackMemory, buildFewShotBlock } from './index.js';

const ri = { id: 'ri-1', organizationId: 'org-demo', summary: 'Order-status antwoord' };

describe('buildFeedbackMemory', () => {
  it('APPROVED → GOOD met verzonden body', () => {
    const m = buildFeedbackMemory({ reviewItem: ri, decision: 'APPROVED', finalBody: 'Verzonden tekst' });
    expect(m).toMatchObject({
      scope: 'PROCESS',
      source: 'feedback',
      sourceRef: 'ri-1',
      label: 'GOOD',
      body: 'Verzonden tekst',
      supersededDraft: null,
    });
  });

  it('EDITED → GOOD met correctie + supersededDraft (origineel)', () => {
    const m = buildFeedbackMemory({
      reviewItem: ri,
      decision: 'EDITED',
      finalBody: 'Gecorrigeerd',
      originalDraft: 'Origineel concept',
    });
    expect(m?.label).toBe('GOOD');
    expect(m?.body).toBe('Gecorrigeerd');
    expect(m?.supersededDraft).toBe('Origineel concept');
  });

  it('REJECTED → BAD met afgewezen draft + reden', () => {
    const m = buildFeedbackMemory({
      reviewItem: ri,
      decision: 'REJECTED',
      originalDraft: 'Slecht concept',
      reason: 'Te formeel',
    });
    expect(m?.label).toBe('BAD');
    expect(m?.body).toContain('Slecht concept');
    expect(m?.body).toContain('Te formeel');
  });

  it('geeft null als er niets te leren valt', () => {
    expect(buildFeedbackMemory({ reviewItem: ri, decision: 'APPROVED' })).toBeNull();
    expect(buildFeedbackMemory({ reviewItem: ri, decision: 'REJECTED' })).toBeNull();
  });
});

describe('buildFewShotBlock', () => {
  it('splitst GOOD (nastreven) en BAD (vermijden) en toont de afgekeurde versie bij een edit', () => {
    const block = buildFewShotBlock([
      { label: 'GOOD', body: 'Goed voorbeeld', supersededDraft: 'oude versie' },
      { label: 'BAD', body: 'Fout voorbeeld' },
    ]);
    expect(block).toContain('Eerder goedgekeurd');
    expect(block).toContain('Goed voorbeeld');
    expect(block).toContain('afgekeurde versie was: oude versie');
    expect(block).toContain('Vermijd');
    expect(block).toContain('Fout voorbeeld');
  });

  it('leeg bij geen voorbeelden', () => {
    expect(buildFewShotBlock([])).toBe('');
  });
});
