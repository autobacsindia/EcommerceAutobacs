import { describe, it, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import {
  findTargets, applyClears, rollback, DEAD_ARTICLE_CANONICALS,
} from '../scripts/clear-bad-seo-canonicals.js';

const LEGACY = 'https://autobacsindia.com/product/old';
const dead = DEAD_ARTICLE_CANONICALS[0];
const coll = (name) => mongoose.connection.db.collection(name);

describe('clear-bad-seo-canonicals', () => {
  beforeEach(async () => {
    await coll('products').deleteMany({ slug: /^canon-/ });
    await coll('articles').deleteMany({ slug: { $in: [dead.slug, 'canon-keep'] } });
    await coll('products').insertMany([
      { slug: 'canon-legacy', seo: { canonical: LEGACY, metaTitle: 'Keep me' } },
      { slug: 'canon-own', seo: { canonical: 'https://www.autobacsindia.com/products/canon-own' } },
      { slug: 'canon-none', seo: {} },
    ]);
    await coll('articles').insertMany([
      { slug: dead.slug, seo: { canonical: dead.canonical } },
      { slug: 'canon-keep', seo: { canonical: 'https://www.autobacsindia.com/other' } },
    ]);
  });

  const select = async () => (await findTargets(mongoose.connection.db))
    .filter((t) => t.slug.startsWith('canon-') || t.slug === dead.slug);

  it('selects only the legacy products and the named dead article', async () => {
    expect((await select()).map((t) => t.slug).sort()).toEqual(['canon-legacy', dead.slug].sort());
  });

  it('clears only the canonical, and a second run changes nothing', async () => {
    const targets = await select();
    expect(await applyClears(mongoose.connection.db, targets)).toBe(2);
    const doc = await coll('products').findOne({ slug: 'canon-legacy' });
    expect(doc.seo).toEqual({ metaTitle: 'Keep me' });
    expect(await applyClears(mongoose.connection.db, targets)).toBe(0);
  });

  it('does not overwrite a value edited after the scan', async () => {
    const targets = await select();
    await coll('products').updateOne({ slug: 'canon-legacy' }, { $set: { 'seo.canonical': '/products/new' } });
    await applyClears(mongoose.connection.db, targets);
    expect((await coll('products').findOne({ slug: 'canon-legacy' })).seo.canonical).toBe('/products/new');
  });

  it('rolls back from the JSON backup, without overwriting newer values', async () => {
    const targets = await select();
    await applyClears(mongoose.connection.db, targets);
    await coll('articles').updateOne({ slug: dead.slug }, { $set: { 'seo.canonical': '/newer' } });
    const backup = JSON.parse(JSON.stringify(targets));
    expect(await rollback(mongoose.connection.db, backup)).toBe(1);
    expect((await coll('products').findOne({ slug: 'canon-legacy' })).seo.canonical).toBe(LEGACY);
    expect((await coll('articles').findOne({ slug: dead.slug })).seo.canonical).toBe('/newer');
  });
});
