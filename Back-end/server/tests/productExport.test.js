/**
 * Admin "Export to Excel" (GET /products/admin/export, services/productExportService.js).
 *
 * The file is opened and read back cell by cell, because the reasons this is an
 * .xlsx and not a CSV are things a status code can't show:
 *   - an SKU like 00123 must stay text (Excel turns a CSV "00123" into 123)
 *   - a name starting with "=" must stay text, never become a formula
 * Plus the catalogue rules: one row per option, drafts in, deleted out, the price
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
import { buildExportRows } from '../services/productExportService.js';

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

/** Open the .xlsx and return the first sheet's XML. */
function sheetXml(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const name = Object.keys(files).find((f) => /^xl\/worksheets\/sheet1\.xml$/.test(f));
  const shared = files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : '';
  return { sheet: strFromU8(files[name]), shared };
}

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

describe('export rows', () => {
  it('writes one row per option, and one row for a product without options', async () => {
    await Product.create(product({ name: 'Plain mat' }));
    await Product.create(product({
      name: 'Seat cover', productType: 'variable',
      variants: [
        { label: 'Black', price: 8500, stock: 'in', sku: 'SC-BLK' },
        { label: 'Sand', price: 8200, stock: 'out', sku: 'SC-SND' },
      ],
    }));

    const rows = await buildExportRows();

    expect(rows.map((r) => [r.name, r.option])).toEqual([
      ['Plain mat', ''],
      ['Seat cover', 'Black'],
      ['Seat cover', 'Sand'],
    ]);
    const sand = rows.find((r) => r.option === 'Sand');
    expect(sand).toMatchObject({ price: 8200, optionSku: 'SC-SND', stock: 'Out of Stock' });
  });

  it('includes drafts as Hidden and leaves deleted products out', async () => {
    await Product.create(product({ name: 'Live one' }));
    await Product.create(product({ name: 'Draft one', isActive: false }));
    await Product.create(product({ name: 'Deleted one', deletedAt: new Date() }));

    const rows = await buildExportRows();

    expect(rows.map((r) => `${r.name}:${r.status}`)).toEqual(['Live one:Live', 'Draft one:Hidden']);
  });

  it('shows the price charged now — an expired sale is shown at its reverted price', async () => {
    const past = new Date(Date.now() - 86400000);
    const future = new Date(Date.now() + 86400000);
    await Product.create(product({ name: 'On sale', price: 800, originalPrice: 1000, saleEndsAt: future }));
    await Product.create(product({ name: 'Sale over', price: 800, originalPrice: 1000, saleEndsAt: past }));
    await Product.create(product({ name: 'Marked down', price: 900, originalPrice: 1200 }));

    const byName = Object.fromEntries((await buildExportRows()).map((r) => [r.name, r]));

    expect(byName['On sale']).toMatchObject({ price: 800, mrp: 1000 });
    expect(byName['On sale'].saleEndsAt).toBeTruthy();
    expect(byName['Sale over']).toMatchObject({ price: 1000, mrp: null, saleEndsAt: null });
    expect(byName['Marked down']).toMatchObject({ price: 900, mrp: 1200, saleEndsAt: null });
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

    const [row] = await buildExportRows();

    expect(row).toMatchObject({ categories: 'Interior', vehicles: 'Toyota Fortuner', brand: 'Autobacs' });
    expect(row.url).toMatch(/\/products\/seat-belt-pad$/);
  });

  it('pages through a catalogue bigger than one page without dropping or repeating', async () => {
    const docs = Array.from({ length: 520 }, () => product());
    await Product.insertMany(docs);

    const rows = await buildExportRows();

    expect(rows).toHaveLength(520);
    expect(new Set(rows.map((r) => r.sku)).size).toBe(520);
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

    const { sheet, shared } = sheetXml(res.body);
    const all = sheet + shared;
    expect(all).toContain('Product name');
    expect(all).toContain('Price now');
    // 00123 survives as text — never written as the number 123.
    expect(all).toContain('00123');
    expect(sheet).not.toMatch(/<v>123<\/v>/);
    // The "formula" is stored as text, and the sheet holds no formula at all.
    expect(all).toContain('HYPERLINK');
    expect(sheet).not.toMatch(/<f>/);
  });
});
