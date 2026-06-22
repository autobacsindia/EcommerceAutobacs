import { jest } from '@jest/globals';

const { importProductsCSV } = await import('../controllers/productBulkController.js');
const Category = (await import('../models/Category.js')).default;
const Product = (await import('../models/Product.js')).default;
const categoryMappingService = (await import('../services/categoryMappingService.js')).default;

// Minimal res stub capturing status + json.
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const csvBuffer = (text) => Buffer.from(text, 'utf8');

describe('Bulk CSV product import', () => {
  beforeEach(async () => {
    await Category.create({ name: 'Lighting', slug: 'lighting', isActive: true });
    categoryMappingService.refresh(); // re-init cache against the seeded category
  });

  it('imports valid rows and reports invalid ones', async () => {
    const csv = [
      'name,description,price,category,brand,stock',
      'LED Headlight,A bright LED headlight for night driving,4999,lighting,Auxbeam,in',
      'X,too short name and no valid category,100,nope,,in',          // bad: name<3 + bad category
      'Fog Lamp Kit,Pair of fog lamps with wiring harness,2999,Lighting,,in', // ok (category by name)
    ].join('\n');

    const res = mockRes();
    await importProductsCSV({ file: { buffer: csvBuffer(csv) } }, res);

    expect(res.body.results.total).toBe(3);
    expect(res.body.results.created).toBe(2);
    expect(res.body.results.failed).toBe(1);
    expect(res.statusCode).toBe(207); // multi-status (some failed)

    const products = await Product.find({}).lean();
    expect(products).toHaveLength(2);
    const headlight = products.find(p => p.name === 'LED Headlight');
    expect(headlight.brand).toBe('Auxbeam');
    expect(headlight.brandSlug).toBe('auxbeam');     // derived
    expect(headlight.slug).toBe('led-headlight');     // generated
    expect(headlight.categories).toHaveLength(1);
  });

  it('generates unique slugs for duplicate names', async () => {
    const csv = [
      'name,description,price,category',
      'Bull Bar,Heavy duty front bull bar guard,8999,lighting',
      'Bull Bar,Another heavy duty front bull bar,9499,lighting',
    ].join('\n');

    const res = mockRes();
    await importProductsCSV({ file: { buffer: csvBuffer(csv) } }, res);

    expect(res.body.results.created).toBe(2);
    const slugs = (await Product.find({}).lean()).map(p => p.slug).sort();
    expect(slugs).toEqual(['bull-bar', 'bull-bar-1']);
  });

  it('rejects an empty / header-only CSV', async () => {
    const res = mockRes();
    await importProductsCSV({ file: { buffer: csvBuffer('name,description,price,category') } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('400s when no file is provided', async () => {
    const res = mockRes();
    await importProductsCSV({}, res);
    expect(res.statusCode).toBe(400);
  });
});
