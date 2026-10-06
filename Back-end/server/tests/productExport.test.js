/**
 * Admin "Export to Excel" (GET /products/admin/export, services/productExportService.js).
 *
 * The file is opened and read back cell by cell, because the reasons this is an
 * .xlsx and not a CSV are things a status code can't show:
 *   - an SKU like 00123 must stay text (Excel turns a CSV "00123" into 123)
 *   - a name starting with "=" must stay text, never become a formula
 * Plus the catalogue rules: one Products row per product (so the count matches the
 * catalogue) and one Options row per option, drafts in, deleted out, the price
 * charged NOW (an expired sale reverts), names resolved, and keyset paging that
 * neither drops nor repeats a product across a page boundary.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { unzipSync, strFromU8 } from 'fflate';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Vehicle from '../models/Vehicle.js';
import * as dbHandler from './db-handler.js';
import { buildExportData } from '../services/productExportService.js';

const BASE = '/api/v1';

let n = 0;
const product = (overrides = {}) => {
  n += 1;
  return {
    name: `Product ${n}`, slug: `product-${n}`, sku: `SKU-${n}`,
    description: 'x'.repeat(30), price: 1000, stock: 'in', isActive: true,
    ...overrides,
  };
};

async function tokenFor(role) {
  const email = `${role}${Date.now()}${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'SecurePass123!';
  await User.create({ name: role, email, passwordHash: await bcrypt.hash(password, 10), role, phone: '9000000001' });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  return cookie ? cookie.split(';')[0].slice('accessToken='.length) : res.body.accessToken;
}

/** Collect the response body as a Buffer (supertest buffers text, not binary). */
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Open the .xlsx: sheet names, every worksheet's XML, and the shared strings. */
function openWorkbook(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const read = (f) => (files[f] ? strFromU8(files[f]) : '');
  const sheets = Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort().map(read);
  const names = [...read('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
  return { names, sheets, shared: read('xl/sharedStrings.xml') };
}
const rowCount = (sheetXml) => (sheetXml.match(/<row /g) || []).length;

beforeAll(async () => {
  await dbHandler.connect();
});

afterEach(async () => {
  await dbHandler.clearDatabase();
});

afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

describe('export data', () => {
  it('has exactly one Products row per product, and one Options row per option', async () => {
    const plain = await Product.create(product({ name: 'Plain mat', price: 1500 }));
    const cover = await Product.create(product({
      name: 'Seat cover', productType: 'variable',
      variants: [
        { label: 'Black', price: 8500, stock: 'in', sku: 'SC-BLK' },
        { label: 'Sand', price: 8200, stock: 'out', sku: 'SC-SND' },
        { label: 'Grey', price: 8500, stock: 'low', sku: 'SC-GRY' },
      ],
    }));

    const { products, options } = await buildExportData();

    expect(products.map((r) => r.name)).toEqual(['Plain mat', 'Seat cover']);
    expect(options.map((r) => `${r.name}:${r.option}`)).toEqual(['Seat cover:Black', 'Seat cover:Sand', 'Seat cover:Grey']);
    // Options link back to their product.
    expect(new Set(options.map((o) => o.id))).toEqual(new Set([String(cover._id)]));

    const byName = Object.fromEntries(products.map((r) => [r.name, r]));
    expect(byName['Plain mat']).toMatchObject({ id: String(plain._id), optionCount: 0, price: 1500, priceTo: null, stock: 'In Stock' });
    // Range across the options; low counts as available, out does not.
    expect(byName['Seat cover']).toMatchObject({ optionCount: 3, price: 8200, priceTo: 8500, mrp: null, stock: '2 of 3 options available' });
    expect(options.find((o) => o.option === 'Sand')).toMatchObject({ price: 8200, optionSku: 'SC-SND', stock: 'Out of Stock' });
  });

  it('shows one price, not a range, when every option costs the same; and says when none are available', async () => {
    await Product.create(product({
      name: 'Same price', productType: 'variable',
      variants: [{ label: 'A', price: 500, stock: 'out' }, { label: 'B', price: 500, stock: 'out' }],
    }));

    const [row] = (await buildExportData()).products;

    expect(row).toMatchObject({ price: 500, priceTo: null, stock: 'Out of Stock (all 2 options)' });
  });

  it('includes drafts as Hidden and leaves deleted products out', async () => {
    await Product.create(product({ name: 'Live one' }));
    await Product.create(product({ name: 'Draft one', isActive: false }));
    await Product.create(product({ name: 'Deleted one', deletedAt: new Date() }));

    const { products } = await buildExportData();

    expect(products.map((r) => `${r.name}:${r.status}`)).toEqual(['Live one:Live', 'Draft one:Hidden']);
  });

  it('shows the price charged now — an expired sale is shown at its reverted price', async () => {
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    await Product.create(product({ name: 'On sale', price: 800, originalPrice: 1000, saleEndsAt: future }));
    await Product.create(product({ name: 'Sale over', price: 800, originalPrice: 1000, saleEndsAt: past }));
    await Product.create(product({ name: 'Marked down', price: 900, originalPrice: 1200 }));

    const byName = Object.fromEntries((await buildExportData()).products.map((r) => [r.name, r]));

    expect(byName['On sale']).toMatchObject({ price: 800, mrp: 1000 });
    expect(byName['On sale'].saleEndsAt).toBeTruthy();
    expect(byName['Sale over']).toMatchObject({ price: 1000, mrp: null, saleEndsAt: null });
    expect(byName['Marked down']).toMatchObject({ price: 900, mrp: 1200, saleEndsAt: null });
  });

  it('applies the same sale rules to each option', async () => {
    await Product.create(product({
      name: 'Kit', productType: 'variable',
      variants: [{ label: 'Old sale', price: 700, originalPrice: 1000, saleEndsAt: new Date(Date.now() - 86400000), stock: 'in' }],
    }));

    const [opt] = (await buildExportData()).options;

    expect(opt).toMatchObject({ price: 1000, mrp: null });
  });

  it('turns category and vehicle references into names, ignoring dangling ones', async () => {
    const cat = await Category.create({ name: 'Interior', slug: 'interior' });
    const car = await Vehicle.create({ make: 'Toyota', model: 'Fortuner', slug: 'toyota-fortuner' });
    await Product.create(product({
      categories: [cat._id, new mongoose.Types.ObjectId()],
      compatibleVehicles: [car._id, new mongoose.Types.ObjectId()],
      brand: 'Autobacs',
      slug: 'seat-belt-pad',
    }));

    const [row] = (await buildExportData()).products;

    expect(row).toMatchObject({ categories: 'Interior', vehicles: 'Toyota Fortuner', brand: 'Autobacs' });
    expect(row.url).toMatch(/\/products\/seat-belt-pad$/);
  });

  it('pages through a catalogue bigger than one page without dropping or repeating', async () => {
    await Product.insertMany(Array.from({ length: 520 }, () => product()));

    const { products } = await buildExportData();

    expect(products).toHaveLength(520);
    expect(new Set(products.map((r) => r.id)).size).toBe(520);
  });
});

describe('GET /products/admin/export', () => {
  it('is refused to anonymous callers and to customers', async () => {
    const anon = await request(app).get(`${BASE}/products/admin/export`);
    expect([401, 403]).toContain(anon.status);

    const customer = await tokenFor('customer');
    const res = await request(app).get(`${BASE}/products/admin/export`).set('Authorization', `Bearer ${customer}`);
    expect(res.status).toBe(403);
  });

  it('gives an admin a real .xlsx with text kept as text and nothing evaluated', async () => {
    await Product.create(product({ name: 'Leading zero part', sku: '00123' }));
    await Product.create(product({ name: '=HYPERLINK("http://evil.example","click")', sku: 'X-1' }));
    await Product.create(product({
      name: 'With options', productType: 'variable',
      variants: [{ label: 'Red', price: 100, stock: 'in' }, { label: 'Blue', price: 120, stock: 'in' }],
    }));
    const admin = await tokenFor('admin');

    const res = await request(app)
      .get(`${BASE}/products/admin/export`)
      .set('Authorization', `Bearer ${admin}`)
      .buffer(true)
      .parse(binary)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/spreadsheetml\.sheet/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="autobacs-products-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.subarray(0, 2).toString()).toBe('PK'); // a zip, i.e. a real workbook

    const { names, sheets, shared } = openWorkbook(res.body);
    expect(names).toEqual(['Products', 'Options']);
    // Header + 3 products on the first sheet; header + 2 options on the second.
    expect(rowCount(sheets[0])).toBe(4);
    expect(rowCount(sheets[1])).toBe(3);
    const all = sheets.join('') + shared;
    expect(all).toContain('Product name');
    expect(all).toContain('Price now');
    // 00123 survives as text — never written as the number 123.
    expect(all).toContain('00123');
    expect(sheets.join('')).not.toMatch(/<v>123<\/v>/);
    // The "formula" is stored as text, and no sheet holds a formula at all.
    expect(all).toContain('HYPERLINK');
    expect(sheets.join('')).not.toMatch(/<f>/);
  });
});
