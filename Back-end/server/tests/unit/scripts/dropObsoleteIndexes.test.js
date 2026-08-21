/**
 * Guards on the obsolete-index drop list.
 *
 * The danger this file exists for: `$indexStats` reports `ops: 0` for indexes that
 * are doing essential work, because it counts QUERY usage and NOT unique-constraint
 * enforcement on writes. `payments.gatewayPaymentId_1` reads 0 ops and is the
 * serialization point that makes webhook processing idempotent. Anyone extending
 * this list from a dead-index report alone could break the money path, so the rules
 * are asserted here rather than left as a comment.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import mongoose from 'mongoose';
import * as dbHandler from '../../db-handler.js';
import Product from '../../../models/Product.js';
import Order from '../../../models/Order.js';
import User from '../../../models/User.js';

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/drop-obsolete-indexes.js'),
  'utf8',
);

describe('drop list safety rules', () => {
  it('never targets a UNIQUE index by name', () => {
    // The money-path and identity indexes that read ops=0 but must never be dropped.
    const forbidden = [
      'gatewayPaymentId_1', 'sku_1', 'invoiceNo_1', 'messageId_1',
      'slug_1', 'email_1', 'reference_1', 'transactionId_1',
    ];
    for (const name of forbidden) {
      expect(src).not.toContain(`index: '${name}'`);
    }
  });

  it('keeps the runtime refusal for unique indexes', () => {
    // Belt and braces: even if the list were edited badly, the script must bail.
    expect(src).toMatch(/if \(found\.unique\)/);
    expect(src).toMatch(/REFUSING/);
  });

  it('is dry-run unless --apply is passed', () => {
    expect(src).toMatch(/const APPLY = process\.argv\.includes\('--apply'\)/);
  });

  it('connects with autoIndex disabled', () => {
    expect(src).toMatch(/autoIndex: false/);
  });

  it('gives every entry a reason and a rollback', () => {
    const entries = src.match(/collection: '[a-z]+', index: '[^']+'/g) || [];
    expect(entries.length).toBeGreaterThan(0);
    const reasons = src.match(/^\s*reason:/gm) || [];
    const rollbacks = src.match(/^\s*recreate:/gm) || [];
    expect(reasons).toHaveLength(entries.length);
    expect(rollbacks).toHaveLength(entries.length);
  });

  it('does not target orders.razorpayOrderId — only the phantom payment.* path', () => {
    // Dropping the real field's index would hurt; the phantom one is what is listed.
    expect(src).toContain("index: 'payment.razorpayOrderId_1'");
    expect(src).not.toMatch(/index: 'razorpayOrderId_1'/);
  });
});

describe('newly declared indexes are real and buildable', () => {
  beforeAll(async () => {
    await dbHandler.connect();
  });
  afterAll(async () => {
    await dbHandler.closeDatabase();
  });

  // These were hand-built in production and existed in no schema. Declaring them is
  // what makes `audit-index-drift --allow-drop` safe, so they must actually build.
  it.each([
    ['Product', 'isActive_1_stock_1'],
    ['Product', 'categories_1_isActive_1'],
    ['Product', 'price_1'],
    ['Order', 'status_1'],
    ['User', 'role_1'],
  ])('%s declares %s', async (modelName, indexName) => {
    const Model = { Product, Order, User }[modelName];
    await Model.syncIndexes();
    const live = await Model.collection.listIndexes().toArray();
    expect(live.map((i) => i.name)).toContain(indexName);
  });

  it('keeps the text index at 3 fields (description deliberately dropped)', () => {
    const entry = Product.schema.indexes().find(([key]) => key.name === 'text');
    expect(entry).toBeDefined();
    const [key] = entry;
    expect(Object.keys(key).sort()).toEqual(['brand', 'name', 'tags']);
    expect(key.description).toBeUndefined();
  });
});
