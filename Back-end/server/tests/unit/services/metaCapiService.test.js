import { jest } from '@jest/globals';
import crypto from 'crypto';
import { buildPurchaseEvent, isEnabled } from '../../../services/metaCapiService.js';
import { contentIdForLineItem, attachContentIds } from '../../../utils/metaCatalogId.js';

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

describe('metaCatalogId — line item content ids', () => {
  const product = { _id: 'p1', wpId: 500, variants: [{ _id: 'v1', wpVariationId: 11469 }] };

  test('simple line item → bare wpId', () => {
    expect(contentIdForLineItem(product, null)).toBe('500');
  });
  test('variant line item → bare wpVariationId', () => {
    expect(contentIdForLineItem(product, 'v1')).toBe('11469');
  });
  test('native product (no wpId) → ab_ fallback', () => {
    expect(contentIdForLineItem({ _id: 'abc' }, null)).toBe('ab_abc');
  });
});

describe('metaCatalogId — attachContentIds (PDP ViewContent id)', () => {
  test('simple product parent id = bare wpId', () => {
    const out = attachContentIds({ _id: 'p', wpId: 500, productType: 'simple' });
    expect(out.metaContentId).toBe('500');
  });
  test('variable product parent id = item_group_id (NOT bare wpId — no parent feed row)', () => {
    const out = attachContentIds({
      _id: 'p', wpId: 11466, productType: 'variable',
      variants: [{ _id: 'v1', wpVariationId: 11469 }, { _id: 'v2', wpVariationId: 11475 }],
    });
    expect(out.metaContentId).toBe('wc_post_id_11466');
    expect(out.variants.map((v) => v.metaContentId)).toEqual(['11469', '11475']);
  });
});

describe('metaCapiService.buildPurchaseEvent', () => {
  const order = {
    _id: { toString: () => 'ORD1' },
    totalAmount: 45000, // rupees
    user: { _id: { toString: () => 'U1' }, email: 'Buyer@Example.com', phone: '9876543210' },
    shippingAddress: { phone: '9876543210' },
    tracking: { fbp: 'fb.1.x', fbc: 'fb.1.y', clientIp: '1.2.3.4', userAgent: 'UA', eventSourceUrl: 'https://s/checkout' },
    items: [
      { product: { _id: 'p1', wpId: 500, variants: [] }, variantId: null, quantity: 2, price: 15000 },
      { product: { _id: 'p2', wpId: 11466, variants: [{ _id: 'v1', wpVariationId: 11469 }] }, variantId: 'v1', quantity: 1, price: 15000 },
    ],
  };

  test('event has dedup id, INR value in rupees, and matching content_ids', () => {
    const e = buildPurchaseEvent(order);
    expect(e.event_name).toBe('Purchase');
    expect(e.event_id).toBe('ORD1');          // == order id, dedups with the Pixel
    expect(e.action_source).toBe('website');
    expect(e.custom_data.currency).toBe('INR');
    expect(e.custom_data.value).toBe(45000);  // rupees, NOT /100
    expect(e.custom_data.content_ids).toEqual(['500', '11469']);
    expect(e.custom_data.content_type).toBe('product');
    expect(e.custom_data.contents).toEqual([
      { id: '500', quantity: 2, item_price: 15000 },
      { id: '11469', quantity: 1, item_price: 15000 },
    ]);
  });

  test('PII is SHA-256 hashed + normalized; browser signals passed through raw', () => {
    const e = buildPurchaseEvent(order);
    expect(e.user_data.em).toEqual([sha('buyer@example.com')]); // lowercased+trimmed
    expect(e.user_data.ph).toEqual([sha('919876543210')]);       // +91 country code
    expect(e.user_data.external_id).toEqual([sha('u1')]); // hash() normalizes (lowercase); real ObjectIds are already lowercase hex
    expect(e.user_data.client_ip_address).toBe('1.2.3.4');
    expect(e.user_data.client_user_agent).toBe('UA');
    expect(e.user_data.fbp).toBe('fb.1.x');
    expect(e.user_data.fbc).toBe('fb.1.y');
  });

  test.each([
    ['9876543210', '919876543210'],       // bare local
    ['09876543210', '919876543210'],      // trunk-0 local
    ['+91 98765 43210', '919876543210'],  // formatted E.164
    ['00919876543210', '919876543210'],   // 00 intl prefix
    ['919876543210', '919876543210'],     // already normalized
  ])('phone %s normalizes+hashes to %s', (input, normalized) => {
    const e = buildPurchaseEvent({
      _id: { toString: () => 'O' }, totalAmount: 1, user: null, items: [],
      shippingAddress: { phone: input }, tracking: {},
    });
    expect(e.user_data.ph).toEqual([sha(normalized)]);
  });

  test('omits empty user_data keys (no email/phone) without crashing', () => {
    const e = buildPurchaseEvent({
      _id: { toString: () => 'ORD2' }, totalAmount: 100, user: null, items: [], tracking: {},
    });
    expect(e.user_data.em).toBeUndefined();
    expect(e.user_data.ph).toBeUndefined();
    expect(e.custom_data.content_ids).toEqual([]);
  });
});

describe('metaCapiService.isEnabled', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  test('false without config, true with pixel id + token', () => {
    delete process.env.META_PIXEL_ID; delete process.env.META_CAPI_ACCESS_TOKEN;
    expect(isEnabled()).toBe(false);
    process.env.META_PIXEL_ID = '123'; process.env.META_CAPI_ACCESS_TOKEN = 'tok';
    expect(isEnabled()).toBe(true);
  });
});
