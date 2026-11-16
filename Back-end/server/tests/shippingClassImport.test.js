/**
 * The reviewed size-class sheet import (utils/shippingClassImport.js behind
 * scripts/import-shipping-classes.js): parsing, dry-run planning, apply and rollback.
 */
import * as dbHandler from './db-handler.js';
import {
  parseSheet, parseSheetClass, planImport, summarizePlan, applyPlan, applyRollback,
} from '../utils/shippingClassImport.js';

const Product = (await import('../models/Product.js')).default;

const HEADER = 'Slug,Product name,Size class,Length cm,Breadth cm,Height cm,Weight kg,Source link,Estimated,Notes';
const csv = (...lines) => [HEADER, ...lines].join('\n');

describe('parseSheetClass', () => {
  test.each([['Small', 'small'], [' LARGE ', 'large'], ['xl', 'xl'], ['Medium', 'medium']])('%p → %s', (v, out) => {
    expect(parseSheetClass(v)).toBe(out);
  });
  test.each([['Not sure'], ['Not sure - check'], [''], [undefined]])('%p → null (left blank)', (v) => {
    expect(parseSheetClass(v)).toBeNull();
  });
  test('an unknown class throws', () => expect(() => parseSheetClass('Huge')).toThrow(/unknown size class/));
});

describe('parseSheet', () => {
  test('refuses the old name-guess draft', () => {
    expect(() => parseSheet('Size guess,Product name,SKU,Slug\nLarge,Roof box,RB1,roof-box'))
      .toThrow(/name-guess draft/);
  });

  test('needs Slug and Size class columns', () => {
    expect(() => parseSheet('Name,Thing\na,b')).toThrow(/"Slug" and "Size class"/);
  });

  test('reads class, online size, link and estimated; column order and BOM do not matter', () => {
    const text = '﻿Size class,Slug,Weight kg,Length cm,Breadth cm,Height cm,Source link,Estimated\n'
      + 'Small,car-vacuum,1.5,40,15,15,https://www.amazon.in/dp/A1,No\n'
      + 'Not sure - check,odd-thing,,,,,,\n';
    const { rows, errors } = parseSheet(text);
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      line: 2, slug: 'car-vacuum', shippingClass: 'small',
      listedSize: { weightKg: 1.5, lengthCm: 40, breadthCm: 15, heightCm: 15, sourceUrl: 'https://www.amazon.in/dp/A1', estimated: false },
    });
    expect(rows[1]).toEqual({ line: 3, slug: 'odd-thing', shippingClass: null, listedSize: null });
  });

  test('collects every bad row instead of stopping at the first', () => {
    const { rows, errors } = parseSheet(csv(
      'ok,,Medium,,,,,,,',
      ',,Small,,,,,,,',
      'half-size,,Small,40,,15,1,,,',
      'bad-class,,Huge,,,,,,,',
      'bad-link,,Small,10,10,10,1,ftp://x,,',
      'too-heavy,,XL,10,10,10,9999,,,',
      'comma,,Small,10,10,10,"1,5",,,',
      'ok,,Large,,,,,,,',
    ));
    expect(rows.map((r) => r.slug)).toEqual(['ok']);
    expect(errors.map((e) => [e.line, e.error.split(' ')[0]])).toEqual([
      [3, 'no'], [4, 'fill'], [5, 'unknown'], [6, 'source'], [7, 'weightKg'], [8, 'weightKg'], [9, 'same'],
    ]);
  });
});

describe('planImport (dry run — pure)', () => {
  const id = (n) => `64b0000000000000000000${String(n).padStart(2, '0')}`;
  const rows = parseSheet(csv(
    'a,,Small,25,10,10,0.8,https://x.in/a,No,',
    'b,,Large,,,,,,,',
    'c,,Not sure,,,,,,,',
    'd,,Medium,,,,,,,',
    'e,,Small,160,80,40,15,https://x.in/e,Yes,',
    'missing,,Small,,,,,,,',
  )).rows;
  const products = [
    { _id: id(1), slug: 'a' },
    { _id: id(2), slug: 'b', shippingClass: 'medium', shippingClassSource: 'manual' },
    { _id: id(3), slug: 'c' },
    { _id: id(4), slug: 'd', shippingClass: 'medium', shippingClassSource: 'manual' },
    { _id: id(5), slug: 'e', shippingClass: 'xl', shippingClassSource: 'auto' },
  ];

  test('plans only real changes, keeps hand-set values, flags a class its size disagrees with', () => {
    const plan = planImport(rows, products);
    expect(plan.updates.map((u) => u.slug)).toEqual(['a', 'e']);
    expect(plan.updates[0].set).toEqual({
      shippingClass: 'small', shippingClassSource: 'manual',
      listedSize: { weightKg: 0.8, lengthCm: 25, breadthCm: 10, heightCm: 10, sourceUrl: 'https://x.in/a', estimated: false },
    });
    expect(plan.skippedManual).toEqual([{ slug: 'b', field: 'class', current: 'medium', sheet: 'large' }]);
    expect(plan.notFound).toEqual(['missing']);
    expect(plan.unchanged).toBe(3); // b (kept), c (not sure), d (already medium)
    expect(plan.mismatches).toEqual([{ slug: 'e', line: 6, sheet: 'small', sizeSays: 'xl' }]);
    expect(summarizePlan(plan)).toMatchObject({ willChange: 2, classes: { Small: 2 }, notSureLeftBlank: 1, notFound: 1 });
  });

  test('--overwrite replaces a hand-set class', () => {
    const plan = planImport(rows, products, { overwrite: true });
    expect(plan.updates.find((u) => u.slug === 'b').set).toEqual({ shippingClass: 'large', shippingClassSource: 'manual' });
  });

  test('"Not sure" never writes a class', () => {
    const plan = planImport(rows, products);
    expect(plan.updates.find((u) => u.slug === 'c')).toBeUndefined();
  });
});

describe('applyPlan / applyRollback (database)', () => {
  beforeAll(async () => { await dbHandler.connect(); }, 120000);
  afterAll(async () => { await dbHandler.closeDatabase(); });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  const seed = (slug, extra = {}) => Product.create({
    name: `Product ${slug}`, description: 'A test product description', price: 100, stock: 'in', slug, isActive: true, ...extra,
  });
  const load = async () => Product.find({}).select('_id slug name shippingClass shippingClassSource shippingSize listedSize').lean();

  test('a dry run (plan only) writes nothing; apply writes; rollback restores', async () => {
    await seed('a');
    await seed('b', { shippingClass: 'small', shippingClassSource: 'auto' });
    const { rows } = parseSheet(csv('a,,Large,100,40,30,12,https://x.in/a,No,', 'b,,Medium,,,,,,,'));

    const plan = planImport(rows, await load());
    expect((await Product.findOne({ slug: 'a' }).lean()).shippingClass).toBeNull(); // planning wrote nothing

    const before = await Product.findOne({ slug: 'a' }).lean();
    const { written, changedSincePlan } = await applyPlan(Product, plan);
    expect(written).toBe(2);
    expect(changedSincePlan).toEqual([]);
    const a = await Product.findOne({ slug: 'a' }).lean();
    expect(a).toMatchObject({ shippingClass: 'large', shippingClassSource: 'manual' });
    expect(a.listedSize).toMatchObject({ lengthCm: 100, weightKg: 12, sourceUrl: 'https://x.in/a' });
    expect(a.updatedAt).toEqual(before.updatedAt); // not a content change

    const backup = JSON.parse(JSON.stringify(plan.updates));
    const { restored } = await applyRollback(Product, backup.map((u) => ({ ...u, _id: u._id })));
    expect(restored).toBe(2);
    expect(await Product.findOne({ slug: 'a' }).lean()).toMatchObject({ shippingClass: null, shippingClassSource: null });
    expect((await Product.findOne({ slug: 'a' }).lean()).listedSize).toMatchObject({ lengthCm: null, sourceUrl: null });
    expect(await Product.findOne({ slug: 'b' }).lean()).toMatchObject({ shippingClass: 'small', shippingClassSource: 'auto' });
  });

  test('a product edited between the dry run and --apply is skipped and reported', async () => {
    await seed('a');
    const plan = planImport(parseSheet(csv('a,,Small,,,,,,,')).rows, await load());
    await Product.updateOne({ slug: 'a' }, { $set: { shippingClass: 'xl', shippingClassSource: 'manual' } });
    const { written, changedSincePlan } = await applyPlan(Product, plan);
    expect(written).toBe(0);
    expect(changedSincePlan).toEqual(['a']);
    expect((await Product.findOne({ slug: 'a' }).lean()).shippingClass).toBe('xl');
  });

  test('rollback leaves alone a product someone changed after the import', async () => {
    await seed('a');
    const plan = planImport(parseSheet(csv('a,,Small,,,,,,,')).rows, await load());
    await applyPlan(Product, plan);
    await Product.updateOne({ slug: 'a' }, { $set: { shippingClass: 'medium' } });
    const { restored } = await applyRollback(Product, plan.updates);
    expect(restored).toBe(0);
    expect((await Product.findOne({ slug: 'a' }).lean()).shippingClass).toBe('medium');
  });

  test('re-applying the same sheet is a no-op', async () => {
    await seed('a');
    const { rows } = parseSheet(csv('a,,Small,25,10,10,0.8,,,'));
    await applyPlan(Product, planImport(rows, await load()));
    const again = planImport(rows, await load());
    expect(again.updates).toEqual([]);
    expect(again.unchanged).toBe(1);
  });
});
