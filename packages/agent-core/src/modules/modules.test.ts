import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODULE,
  categoryKey,
  categoryKeyMatches,
  categoryLabelIn,
  moduleForKind,
  parseCategoryKey,
  type ModuleDescriptor,
} from './index.js';
import { KLANTENSERVICE_TAXONOMY as CATEGORIES } from './klantenservice/taxonomy.js';
import { KLANTENSERVICE_MODULE } from './klantenservice/descriptor.js';

const SALES: ModuleDescriptor = {
  id: 'sales',
  label: 'Sales',
  description: 'Offertes en opvolging.',
  kinds: ['quote', 'task'],
  categories: [
    { slug: 'offerte_aanvraag', label: 'Offerte-aanvraag' },
    // Deelt bewust een slug met klantenservice: dezelfde naam betekent in een
    // ander proces iets anders, en de registry moet daarop voorbereid zijn.
    { slug: 'commercieel', label: 'Commerciële kans' },
  ],
};

describe('modulecontract', () => {
  it('valt terug op klantenservice voor historie zonder module', () => {
    expect(DEFAULT_MODULE).toBe('klantenservice');
  });

  it('laat de klantenservice-module de taxonomie van de klant dragen', () => {
    // De categorieën komen uit de taxonomie van het pakket — het bestand dat je
    // per klant aanpast. Loopt dat uit de pas, dan classificeert de agent op
    // slugs die de cockpit niet kent.
    expect(KLANTENSERVICE_MODULE.categories).toHaveLength(CATEGORIES.length);
    expect(KLANTENSERVICE_MODULE.categories.map((c) => c.slug)).toEqual(
      CATEGORIES.map((c) => c.slug),
    );
  });

  it('claimt de vormen die de mailagent produceert', () => {
    expect(KLANTENSERVICE_MODULE.kinds).toContain('draft_email');
    expect(KLANTENSERVICE_MODULE.kinds).toContain('draft_reply');
  });

  it('vertaalt een categorie binnen de module die hem kent', () => {
    expect(categoryLabelIn(SALES, 'commercieel')).toBe('Commerciële kans');
  });

  it('geeft dezelfde slug in twee modules een eigen label', () => {
    // Precies waarom de vertaling per module gaat en niet via één gedeelde
    // tabel. Bewust getoetst tegen de eigen categorieën van de module en niet
    // tegen een hardgecodeerd label: `taxonomy/` wordt bij elke klant opnieuw
    // ingericht, dus een kerntest die op één labelwaarde leunt valt bij elke
    // kloon om zonder dat er iets kapot is.
    //
    // De tweede module wordt hier afgeleid van de eerste slug van de
    // klantenservice-module. Zonder die constructie zou de test slagen omdat de
    // andere module de slug niet ként — dat toetst de vertaling niet, alleen de
    // terugval op onbekend.
    const eigen = KLANTENSERVICE_MODULE.categories[0];
    expect(eigen).toBeDefined();

    const botsend: ModuleDescriptor = {
      ...SALES,
      categories: [{ slug: eigen!.slug, label: `${eigen!.label} (sales)` }],
    };

    expect(categoryLabelIn(KLANTENSERVICE_MODULE, eigen!.slug)).toBe(eigen!.label);
    expect(categoryLabelIn(botsend, eigen!.slug)).toBe(`${eigen!.label} (sales)`);
  });

  it('geeft een onbekende slug terug in plaats van hem te laten verdwijnen', () => {
    expect(categoryLabelIn(SALES, 'bestaat_niet')).toBe('bestaat_niet');
    expect(categoryLabelIn(SALES, null)).toBeNull();
  });

  it('vindt de module bij een vorm als het item geen module draagt', () => {
    const registered = [KLANTENSERVICE_MODULE, SALES];
    expect(moduleForKind(registered, 'draft_email')?.id).toBe('klantenservice');
    expect(moduleForKind(registered, 'quote')?.id).toBe('sales');
  });

  it('claimt niets bij een onbekende vorm', () => {
    // Null en niet "de eerste module": een voorstel uit een automatisering die
    // hier niet draait, hoort zichtbaar te zijn en niet in andermans bak.
    expect(moduleForKind([KLANTENSERVICE_MODULE, SALES], 'shipment_label')).toBeNull();
  });
});

describe('categorie-sleutels', () => {
  it('kwalificeert een slug met zijn module', () => {
    expect(categoryKey('administratie', 'facturatie')).toBe(
      'administratie:facturatie',
    );
  });

  it('houdt dezelfde slug in twee modules uit elkaar', () => {
    // De reden dat deze sleutel bestaat. Zonder hem is 'facturatie' één ding,
    // en verdwijnt de tweede uit de beleidseditor zodra de eerste er staat.
    expect(categoryKey('klantenservice', 'facturatie')).not.toBe(
      categoryKey('administratie', 'facturatie'),
    );
  });

  it('splitst een sleutel terug in module en slug', () => {
    expect(parseCategoryKey('sales:offerte_aanvraag')).toEqual({
      module: 'sales',
      slug: 'offerte_aanvraag',
    });
  });

  it('leest een kale slug als "elke module"', () => {
    // Beleidsregels van vóór de namespacing dragen geen module. Die moeten
    // blijven matchen, anders valt het beleid van een klant die de migratie nog
    // niet draaide stilzwijgend weg.
    expect(parseCategoryKey('facturatie')).toEqual({
      module: null,
      slug: 'facturatie',
    });
    expect(categoryKeyMatches('facturatie', 'klantenservice', 'facturatie')).toBe(true);
    expect(categoryKeyMatches('facturatie', 'administratie', 'facturatie')).toBe(true);
  });

  it('laat een gekwalificeerde sleutel alleen in zijn eigen module matchen', () => {
    const sleutel = categoryKey('klantenservice', 'facturatie');
    expect(categoryKeyMatches(sleutel, 'klantenservice', 'facturatie')).toBe(true);
    expect(categoryKeyMatches(sleutel, 'administratie', 'facturatie')).toBe(false);
  });

  it('matcht niet op een andere slug binnen dezelfde module', () => {
    expect(
      categoryKeyMatches(categoryKey('klantenservice', 'klacht'), 'klantenservice', 'facturatie'),
    ).toBe(false);
  });

  it('overleeft een slug met een streepje of underscore', () => {
    // Het scheidingsteken mag niet in een slug kunnen voorkomen; dit is de
    // toets dat we het juiste teken kozen.
    const sleutel = categoryKey('operations', 'retour-ruilen_v2');
    expect(parseCategoryKey(sleutel)).toEqual({
      module: 'operations',
      slug: 'retour-ruilen_v2',
    });
  });
});
