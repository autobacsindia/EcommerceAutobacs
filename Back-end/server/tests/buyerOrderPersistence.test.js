/**
 * Buyer identity + legal acceptance, persisted — REAL database.
 *
 * The unit tests prove buyerService decides correctly. These prove the decision
 * SURVIVES the write, and — more importantly — that the ~1,500 orders which
 * predate the field still read correctly.
 *
 * ⚠️ THE LEGACY CASE CANNOT BE TESTED WITH A MODEL-BUILT FIXTURE. `new Order({...})`
 * applies schema defaults, so a fixture written that way has whatever shape the
 * CURRENT schema says — never the shape production actually holds. That is
 * exactly how a `{ $size: 0 }` guard shipped that matched 0 of 1,599 real orders.
 * So the legacy tests below write with a raw driver `$unset`, reproducing a
 * document with no `buyer` key at all.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { useTransactionalDb } from './helpers/replicaSet.js';

import Product from '../models/Product.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import orderService from '../services/orderService.js';
import { resolveBuyerAndAcceptance } from '../services/buyerService.js';
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from '../config/legalDocuments.js';

jest.setTimeout(120000);

const ADDRESS = {
  fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
  city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
};

const GSTIN = '27AAPFU0939F1ZV';

const ENTERPRISE_BODY = {
  acceptTerms: true,
  buyer: {
    type: 'enterprise',
    legalName: 'Roavion Motors Private Limited',
    gstin: GSTIN,
    billingAddress: { addressLine1: '12 Marine Drive', city: 'Kochi', postalCode: '682011' },
  },
};

let slugSeq = 0;
const seedProduct = (price = 1000) => Product.create({
  name: `Prod ${price}`, slug: `prod-${price}-${++slugSeq}`, description: 'Test product',
  price, stock: 'in', brand: 'B', isActive: true,
});
const seedUser = () => User.create({
  name: 'U', email: `u${Date.now()}${Math.random()}@x.com`, passwordHash: 'x',
});

/** Place an order the way a controller does: resolve, then create. */
const placeOrder = async (user, product, body) => {
  const { buyer, legalAcceptance } = resolveBuyerAndAcceptance(body, { ipHash: 'testhash' });
  return orderService.createOrder(
    user._id,
    [{ product: product._id, quantity: 1 }],
    ADDRESS,
    { ...body, buyer, legalAcceptance, shippingCost: 0 },
  );
};

beforeAll(async () => {
  await useTransactionalDb();
});

describe('enterprise order', () => {
  it('persists the buyer block with the state derived from the GSTIN', async () => {
    const order = await placeOrder(await seedUser(), await seedProduct(), ENTERPRISE_BODY);
    const stored = await Order.findById(order._id).lean();

    expect(stored.buyer).toMatchObject({
      type: 'enterprise',
      legalName: 'Roavion Motors Private Limited',
      gstin: GSTIN,
      stateCode: '27',
    });
    // Never typed by the buyer — read off the GSTIN.
    expect(stored.buyer.billingAddress.state).toBe('Maharashtra');
    expect(stored.buyer.billingAddress.city).toBe('Kochi');
  });

  it('persists the acceptance with the SERVER version, not the client one', async () => {
    const order = await placeOrder(await seedUser(), await seedProduct(), {
      ...ENTERPRISE_BODY,
      legalAcceptance: { termsVersion: '1999-01-01' },  // ignored
    });
    const stored = await Order.findById(order._id).lean();

    expect(stored.legalAcceptance).toMatchObject({
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
      track: 'enterprise',
      ipHash: 'testhash',
    });
    expect(stored.legalAcceptance.acceptedAt).toBeInstanceOf(Date);
  });

  it('is rejected outright when the terms are not accepted', async () => {
    const user = await seedUser();
    const product = await seedProduct();
    await expect(placeOrder(user, product, { ...ENTERPRISE_BODY, acceptTerms: false }))
      .rejects.toThrow(/must accept the Terms/);

    // And nothing was written — an unaccepted order must not exist at all.
    expect(await Order.countDocuments({ user: user._id })).toBe(0);
  });

  it('is rejected when the GSTIN has a typo, leaving no order behind', async () => {
    const user = await seedUser();
    const product = await seedProduct();
    await expect(placeOrder(user, product, {
      ...ENTERPRISE_BODY,
      buyer: { ...ENTERPRISE_BODY.buyer, gstin: '27AAPFU0939F1ZW' },
    })).rejects.toThrow(/check-digit/);
    expect(await Order.countDocuments({ user: user._id })).toBe(0);
  });
});

describe('individual order', () => {
  it('records the consumer track and stores no GSTIN', async () => {
    const order = await placeOrder(await seedUser(), await seedProduct(), { acceptTerms: true });
    const stored = await Order.findById(order._id).lean();

    expect(stored.buyer).toEqual({ type: 'individual' });
    expect(stored.legalAcceptance.track).toBe('consumer');
  });

  it('carries no empty billingAddress subdoc', async () => {
    // A phantom nested subdoc on every consumer order is how this codebase
    // previously shipped a fake return request onto 1,521 orders.
    const order = await placeOrder(await seedUser(), await seedProduct(), { acceptTerms: true });
    const stored = await Order.findById(order._id).lean();
    expect(stored.buyer.billingAddress).toBeUndefined();
    expect(stored.buyer.gstin).toBeUndefined();
  });
});

describe('legacy orders (no buyer field at all)', () => {
  /**
   * Reproduce a pre-migration document: create through the model, then strip the
   * new fields with the raw driver so the stored document genuinely lacks the
   * keys — which is what the ~1,500 existing production orders look like.
   */
  const seedLegacyOrder = async () => {
    const user = await seedUser();
    const product = await seedProduct();
    const order = await placeOrder(user, product, { acceptTerms: true });
    await mongoose.connection.collection('orders').updateOne(
      { _id: order._id },
      { $unset: { buyer: '', legalAcceptance: '' } },
    );
    return order._id;
  };

  it('really has no buyer key, so the fixture is what production holds', async () => {
    const id = await seedLegacyOrder();
    const raw = await mongoose.connection.collection('orders').findOne({ _id: id });
    // Guards the fixture itself: if $unset stopped working, every test below
    // would pass while testing nothing.
    expect('buyer' in raw).toBe(false);
    expect('legalAcceptance' in raw).toBe(false);
  });

  it('loads through the model without materialising a buyer', async () => {
    const stored = await Order.findById(await seedLegacyOrder()).lean();
    expect(stored.buyer).toBeUndefined();
    expect(stored.legalAcceptance).toBeUndefined();
  });

  it('survives optional-chained reads the way callers do', async () => {
    const stored = await Order.findById(await seedLegacyOrder()).lean();
    expect(stored.buyer?.type).toBeUndefined();
    expect(stored.buyer?.gstin).toBeUndefined();
    expect(stored.buyer?.billingAddress?.state).toBeUndefined();
    expect(stored.legalAcceptance?.termsVersion).toBeUndefined();
  });

  it('is not matched by a query for enterprise buyers', async () => {
    // The reporting case: "all B2B orders" must not sweep in 1,500 legacy rows.
    await seedLegacyOrder();
    const enterpriseUser = await seedUser();
    await placeOrder(enterpriseUser, await seedProduct(), ENTERPRISE_BODY);

    const enterpriseOrders = await Order.find({ 'buyer.type': 'enterprise' }).lean();
    expect(enterpriseOrders).toHaveLength(1);
    expect(enterpriseOrders[0].user.toString()).toBe(enterpriseUser._id.toString());
  });

  it('IS matched by a query for non-enterprise orders, alongside new ones', async () => {
    // The mirror case, and the one that catches a naive `{ 'buyer.type': 'individual' }`
    // filter: a legacy order has no buyer at all, so it is neither — a report
    // written that way would silently under-count consumer sales by ~1,500.
    await seedLegacyOrder();
    await placeOrder(await seedUser(), await seedProduct(), { acceptTerms: true });

    const naive = await Order.find({ 'buyer.type': 'individual' }).countDocuments();
    const correct = await Order.find({ 'buyer.type': { $ne: 'enterprise' } }).countDocuments();
    expect(naive).toBe(1);     // misses the legacy order
    expect(correct).toBe(2);   // includes it
  });
});
