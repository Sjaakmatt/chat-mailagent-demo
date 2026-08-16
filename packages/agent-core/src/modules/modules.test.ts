import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODULE,
  KLANTENSERVICE_MODULE,
  categoryLabelIn,
  moduleForKind,
  type ModuleDescriptor,
} from './index.js';
import { CATEGORIES } from '../taxonomy/index.js';

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
    // De categorieën komen uit taxonomy/ — het bestand dat je per klant
    // aanpast. Loopt dat uit de pas, dan classificeert de agent op slugs die de
    // cockpit niet kent.
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
    // tegen een hardgecodeerd label: `taxonomy/` is het bestand dat je per
    // klant aanpast, dus een kerntest die daarop leunt valt bij elke klant om.
    const eigen = KLANTENSERVICE_MODULE.categories[0];
    expect(eigen).toBeDefined();
    expect(categoryLabelIn(KLANTENSERVICE_MODULE, eigen!.slug)).toBe(eigen!.label);
    expect(categoryLabelIn(SALES, eigen!.slug)).not.toBe(eigen!.label);
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
