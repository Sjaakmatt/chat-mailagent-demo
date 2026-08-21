import { describe, it, expect } from 'vitest';
import {
  categoryGuide,
  categorySlugs,
  categoryToSpecialist,
  categoryLabel,
} from '../../taxonomy/index.js';
import { knownSpecialistIds } from '../../specialists/index.js';
import { KLANTENSERVICE_TAXONOMY as CATEGORIES } from './taxonomy.js';
import { KLANTENSERVICE_SPECIALISTS } from './specialists/index.js';

const CATEGORY_SLUGS = categorySlugs(CATEGORIES);
const CATEGORY_GUIDE = categoryGuide(CATEGORIES);
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.label]));

describe('categorie-taxonomie', () => {
  it('heeft unieke slugs', () => {
    expect(new Set(CATEGORY_SLUGS).size).toBe(CATEGORY_SLUGS.length);
  });

  it('verwijst alleen naar bestaande specialisten', () => {
    const known = new Set(knownSpecialistIds(KLANTENSERVICE_SPECIALISTS));
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

  it('zet elke categorie in de gids die de classifier krijgt', () => {
    // Staat een slug niet in de gids, dan kan het model hem niet kiezen terwijl
    // de validatie hem wél accepteert — de categorie bestaat dan op papier maar
    // wordt nooit toegekend.
    for (const slug of CATEGORY_SLUGS) {
      expect(CATEGORY_GUIDE, `slug '${slug}' ontbreekt in de gids`).toContain(`- ${slug}`);
    }
  });

  it('geeft de startset een afbakening mee, niet alleen een naam', () => {
    // Een hint is optioneel in het type — een klant mag er een leeglaten. Maar
    // de startset die wij meeleveren hoort te laten zien hoe het moet, want dat
    // is het voorbeeld waar elke kloon van vertrekt.
    for (const c of CATEGORIES) {
      expect(c.hint, `categorie '${c.slug}' heeft geen hint`).toBeTruthy();
    }
  });

  it('valt terug op escalate bij een onbekende categorie', () => {
    expect(categoryToSpecialist(CATEGORIES, 'bestaat_niet')).toBe('escalate');
    expect(categoryToSpecialist(CATEGORIES, '')).toBe('escalate');
  });

  it('geeft de slug terug als er geen label is', () => {
    expect(categoryLabel(CATEGORIES, 'bestaat_niet')).toBe('bestaat_niet');
    expect(categoryLabel(CATEGORIES, null)).toBeNull();
  });
});
