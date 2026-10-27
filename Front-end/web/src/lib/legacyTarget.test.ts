/**
 * Where dead WooCommerce-era URLs go now that /products/search (noindex)
 * is off the table: the vehicle they name, the product they became, or a 404.
 * Cases from the Search Console report (Oct 2026).
 */
import { legacyTarget, matchVehicle, wordOverlap } from './legacyTarget';

const V = (slug: string, make: string, model: string) => ({ slug, make, model });
const vehicles = [
  V('toyota-hilux', 'Toyota', 'Hilux'),
  V('toyota-fortuner', 'Toyota', 'Fortuner'),
  V('toyota-innova', 'Toyota', 'Innova'),
  V('toyota-innova-hycross', 'Toyota', 'Innova Hycross'),
  V('mahindra-thar', 'Mahindra', 'Thar'),
  V('bmw-5-series', 'BMW', '5 Series'),
  V('mercedes-benz-g-class', 'Mercedes-Benz', 'G-Class'),
];
const none = { vehicles, products: [] };

describe('/model/<old tag archive>', () => {
  it.each([
    ['hilux', '/model/toyota-hilux'],
    ['fortuner', '/model/toyota-fortuner'],
    ['thar-steering-wheel-grip', '/model/mahindra-thar'],
    ['hilux-led-lights', '/model/toyota-hilux'],
    ['innova-hycross-seat-covers', '/model/toyota-innova-hycross'], // the longer model wins
    ['innova-crysta-mats', '/model/toyota-innova'],
    ['g-class-bumper', '/model/mercedes-benz-g-class'],
  ])('%s → %s', (slug, to) => {
    expect(legacyTarget(slug, 'model', none)).toBe(to);
  });

  it('nothing it names → 404 (null), never a search page', () => {
    expect(legacyTarget('summer-sale-2019', 'model', none)).toBeNull();
    expect(legacyTarget('', 'model', none)).toBeNull();
  });

  it('no vehicle but a matching product → that product', () => {
    const products = [{ slug: 'universal-led-fog-lamp' }];
    expect(legacyTarget('universal-led-fog-lamp-2', 'model', { vehicles, products })).toBe('/products/universal-led-fog-lamp');
  });
});

describe('/products/<old product>', () => {
  const products = [
    { slug: 'headlight-for-bmw-5-series-f10-2010-2013' },
    { slug: 'bmw-5-series-f10-g30-inspired-light-bar-taillight' },
    { slug: 'toyota-hilux-led-tail-light' },
    { slug: 'toyota-hilux-roof-led-lights' },
  ];

  it('a slug that is just a car name goes to that car — not to a headlight that mentions it', () => {
    expect(legacyTarget('bmw-5-series', 'product', { vehicles, products })).toBe('/model/bmw-5-series');
  });

  it('a renamed / "-2" duplicate product goes to the product', () => {
    expect(legacyTarget('toyota-hilux-led-tail-light-2', 'product', { vehicles, products })).toBe('/products/toyota-hilux-led-tail-light');
    expect(legacyTarget('hilux-led-tail-light', 'product', { vehicles, products })).toBe('/products/toyota-hilux-led-tail-light');
  });

  it('a product that only shares a few words falls back to the vehicle it names', () => {
    expect(legacyTarget('toyota-hilux-snorkel-kit', 'product', { vehicles, products })).toBe('/model/toyota-hilux');
  });

  it('no product and no vehicle → 404', () => {
    expect(legacyTarget('mystery-gadget', 'product', { vehicles, products })).toBeNull();
  });
});

describe('matching details', () => {
  it('matches whole words only', () => {
    expect(matchVehicle('tharsis-mats', vehicles)).toBeNull();
    expect(matchVehicle('hiluxx', vehicles)).toBeNull();
  });

  it('word overlap is 1 for the same words in any order, 0 for none', () => {
    expect(wordOverlap('led-tail-light', 'tail-light-led')).toBe(1);
    expect(wordOverlap('a-b', 'c-d')).toBe(0);
  });
});
