/**
 * productRepository.findAllBrands — the storefront "Shop by brand" source.
 *
 * THE BUG THIS GUARDS
 * --------------------
 * Car makes live in the Brand collection too (`type: 'make'`, for the
 * make-facing UI). The brand list only hides rows with zero products, so the
 * moment one product carried a make's name as its `brand` ("Jeep Wrangler Metal
 * Side Steps" → brand "Jeep"), Jeep appeared under "Shop by brand" between
 * Ironman 4x4 and Lightforce. The list must contain parts manufacturers and the
 * house brand only — never a car make, whatever the products say.
 */

import * as dbHandler from './db-handler.js';
import Brand from '../models/Brand.js';
import productRepository from '../repositories/productRepository.js';

beforeAll(async () => {
  await dbHandler.connect();
});

describe('productRepository.findAllBrands', () => {
  it('excludes car makes but keeps manufacturers and the house brand', async () => {
    await Brand.create([
      { name: 'Ironman 4x4', slug: 'ironman-4x4', type: 'manufacturer' },
      { name: 'Jeep', slug: 'jeep', type: 'make' },
      { name: 'Autobacs India', slug: 'autobacs-india', type: 'house' },
      { name: 'Lightforce', slug: 'lightforce' }, // type defaults to manufacturer
    ]);

    const names = (await productRepository.findAllBrands()).map((b) => b.name);

    expect(names).toEqual(['Autobacs India', 'Ironman 4x4', 'Lightforce']);
    expect(names).not.toContain('Jeep');
  });

  it('still excludes inactive brands', async () => {
    await Brand.create([
      { name: 'Bushranger', slug: 'bushranger', type: 'manufacturer' },
      { name: 'Legender', slug: 'legender', type: 'manufacturer', isActive: false },
    ]);

    const names = (await productRepository.findAllBrands()).map((b) => b.name);

    expect(names).toEqual(['Bushranger']);
  });
});
