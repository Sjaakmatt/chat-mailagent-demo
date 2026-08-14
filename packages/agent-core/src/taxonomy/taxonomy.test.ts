import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_SLUGS,
  CATEGORY_LABELS,
  categoryToSpecialist,
  categoryLabel,
} from './index.js';
import { knownSpecialistIds } from '../specialists/index.js';

describe('categorie-taxonomie', () => {
  it('heeft unieke slugs', () => {
    expect(new Set(CATEGORY_SLUGS).size).toBe(CATEGORY_SLUGS.length);
  });

  it('verwijst alleen naar bestaande specialisten', () => {
    const known = new Set(knownSpecialistIds());
    for (const c of CATEGORIES) {
      expect(known, `categorie '${c.slug}' wijst naar onbekende specialist`).toContain(
        c.specialist,
      );
    }
  });

  it('heeft voor elke slug een label', () => {
    for (const slug of CATEGORY_SLUGS) {
      expect(CATEGORY_LABELS[slug]).toBeTruthy();
    }
  });

  it('bevat een overig-categorie als vangnet', () => {
    expect(CATEGORY_SLUGS).toContain('overig');
  });

  it('valt terug op escalate bij een onbekende categorie', () => {
    expect(categoryToSpecialist('bestaat_niet')).toBe('escalate');
    expect(categoryToSpecialist('')).toBe('escalate');
  });

  it('geeft de slug terug als er geen label is', () => {
    expect(categoryLabel('bestaat_niet')).toBe('bestaat_niet');
    expect(categoryLabel(null)).toBeNull();
  });
});
