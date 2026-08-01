import {
  buildGoogleMerchantFeed,
  buildItemsForProduct,
} from '../../../services/googleFeedService.js';
import { googleOfferId, googleVariantOfferId, googleItemGroupId } from '../../../utils/googleCatalogId.js';
import {
  productContentId,
  variantContentId,
  itemGroupId,
  MAX_CONTENT_ID_LENGTH,
} from '../../../utils/metaCatalogId.js';

// What these tests lock down, in order of how expensive the mistake would be:
//   1. Offer ids stay IDENTICAL to the Meta catalogue ids — that shared id is
//      what makes order line items usable for Google cart-data reporting.
//   2. Invalid rows (no image, non-positive price) never reach Google. A ₹0 or
//      ₹2 item is not a warning, it is a real Shopping ad at a real price.
//   3. Google's own rules: underscored availability, backorder → out_of_stock
//      (we have no availability_date), 150/5000 length caps.

const OPTS = {
  siteUrl: 'https://www.autobacsindia.com',
  defaultBrand: 'Autobacs India',
  googleCategory: 'Vehicles & Parts > Vehicle Parts & Accessories',
};

const img = (url, isPrimary = false) => ({ url, isPrimary });

const simple = (over = {}) => ({
  _id: 'a1',
  wpId: 11466,
  name: 'Roof Rack',
  slug: 'roof-rack',
  price: 4999,
  stock: 'in',
  images: [img('https://cdn/x.jpg', true)],
  ...over,
});

describe('googleFeedService — offer ids match the Meta catalogue ids', () => {
  test('simple, variant and group ids are the shared scheme', () => {
    const product = { wpId: 11466, _id: 'x' };
    const variant = { wpVariationId: 11469, _id: 'v' };

    expect(googleOfferId(product)).toBe(productContentId(product));
    expect(googleVariantOfferId(product, variant)).toBe(variantContentId(product, variant));
    expect(googleItemGroupId(product)).toBe(itemGroupId(product));

    // And concretely, so a refactor of either module is caught here.
    expect(googleOfferId(product)).toBe('11466');
    expect(googleVariantOfferId(product, variant)).toBe('11469');
    expect(googleItemGroupId(product)).toBe('wc_post_id_11466');
  });

  test('natively-created products fall back to the deterministic ab_ id', () => {
    expect(googleOfferId({ _id: 'abc123' })).toBe('ab_abc123');
  });

  // Merchant Center caps `id` at 50 chars and warned on 2026-08-01 when a native
  // variable product produced `ab_<productId>_<variantId>` = 52. Real Mongo
  // ObjectIds (24 hex) are the worst case, so assert against those, not short
  // fixtures — short fixtures are exactly why the overflow shipped.
  test('every id form stays within Google\'s 50-character cap for real ObjectIds', () => {
    const product = { _id: '6a61b935c7dbb8d2b6e6d9ef' };          // 24 hex, no wpId
    const variant = { _id: '6a61b935c7dbb8d2b6e6d9f2' };           // 24 hex, no wpVariationId

    const ids = [
      googleOfferId(product),
      googleVariantOfferId(product, variant),
      googleItemGroupId(product),
    ];

    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(MAX_CONTENT_ID_LENGTH);
    }
    // The variant id carries the variant's own ObjectId, not the pair.
    expect(googleVariantOfferId(product, variant)).toBe('ab_6a61b935c7dbb8d2b6e6d9f2');
  });
});

describe('googleFeedService — item mapping', () => {
  test('simple product maps to one valid row', () => {
    const [item] = buildItemsForProduct(simple(), OPTS);

    expect(item).toMatchObject({
      id: '11466',
      itemGroupId: null,
      title: 'Roof Rack',
      link: 'https://www.autobacsindia.com/products/roof-rack',
      image: 'https://cdn/x.jpg',
      brand: 'Autobacs India',
      condition: 'new',
      availability: 'in_stock',
      price: '4999.00 INR',
      salePrice: null,
      googleCategory: 'Vehicles & Parts > Vehicle Parts & Accessories',
    });
  });

  test('an active sale emits price = original and sale_price = discounted', () => {
    const [item] = buildItemsForProduct(
      simple({ price: 3999, originalPrice: 4999, saleEndsAt: new Date(Date.now() + 86400000) }),
      OPTS
    );
    expect(item.price).toBe('4999.00 INR');
    expect(item.salePrice).toBe('3999.00 INR');
  });

  test('an EXPIRED sale reverts to the original price with no sale_price', () => {
    const [item] = buildItemsForProduct(
      simple({ price: 3999, originalPrice: 4999, saleEndsAt: new Date(Date.now() - 86400000) }),
      OPTS
    );
    expect(item.price).toBe('4999.00 INR');
    expect(item.salePrice).toBeNull();
  });

  test('backorder maps to out_of_stock (no availability_date to give Google)', () => {
    const [item] = buildItemsForProduct(simple({ stock: 'backorder' }), OPTS);
    expect(item.availability).toBe('out_of_stock');
  });

  test('out-of-stock items stay in the feed so their ad history survives', () => {
    const [item] = buildItemsForProduct(simple({ stock: 'out' }), OPTS);
    expect(item.availability).toBe('out_of_stock');
  });

  test('sku becomes mpn; without one the row declares identifier_exists=no', () => {
    const withSku = buildGoogleMerchantFeed([simple({ sku: 'RR-100' })], OPTS);
    expect(withSku).toContain('<g:mpn>RR-100</g:mpn>');
    expect(withSku).not.toContain('identifier_exists');

    const without = buildGoogleMerchantFeed([simple()], OPTS);
    expect(without).toContain('<g:identifier_exists>no</g:identifier_exists>');
  });

  test('populated categories become product_type values; raw ids are skipped', () => {
    const [item] = buildItemsForProduct(
      simple({ categories: [{ name: 'Exterior' }, { name: 'Roof Racks' }, 'raw-object-id'] }),
      OPTS
    );
    expect(item.productTypes).toEqual(['Exterior', 'Roof Racks']);
  });

  test('product brand wins over the fallback brand', () => {
    const [item] = buildItemsForProduct(simple({ brand: '70mai' }), OPTS);
    expect(item.brand).toBe('70mai');
  });

  test('title and description are capped at Google limits', () => {
    const [item] = buildItemsForProduct(
      simple({ name: 'x'.repeat(300), shortDescription: 'y'.repeat(6000) }),
      OPTS
    );
    expect(item.title).toHaveLength(150);
    expect(item.description).toHaveLength(5000);
  });
});

describe('googleFeedService — rows Google would reject are dropped', () => {
  test('a product with no image is skipped', () => {
    expect(buildItemsForProduct(simple({ images: [] }), OPTS)).toEqual([]);
  });

  test('a zero-priced product is skipped', () => {
    expect(buildItemsForProduct(simple({ price: 0 }), OPTS)).toEqual([]);
  });

  test('only the invalid variants of a variable product are dropped', () => {
    const items = buildItemsForProduct(
      {
        ...simple({ productType: 'variable' }),
        variants: [
          { _id: 'v1', wpVariationId: 11469, label: 'Petrol', price: 2500, stock: 'in' },
          { _id: 'v2', wpVariationId: 11475, label: 'Diesel', price: 0, stock: 'in' },
        ],
      },
      OPTS
    );

    expect(items.map((i) => i.id)).toEqual(['11469']);
    expect(items[0]).toMatchObject({
      itemGroupId: 'wc_post_id_11466',
      title: 'Roof Rack - Petrol',
      price: '2500.00 INR',
    });
  });
});

describe('googleFeedService — document', () => {
  test('emits a well-formed RSS shell with the g: namespace', () => {
    const xml = buildGoogleMerchantFeed([simple()], { ...OPTS, companyName: 'Autobacs India' });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain('<g:id>11466</g:id>');
    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml.trim().endsWith('</rss>')).toBe(true);
  });

  test('XML-escapes product data so one product cannot corrupt the document', () => {
    const xml = buildGoogleMerchantFeed([simple({ name: 'Rack & "Bar" <b>' })], OPTS);
    expect(xml).toContain('<g:title>Rack &amp; &quot;Bar&quot; &lt;b&gt;</g:title>');
  });

  test('an empty catalogue still produces a valid empty feed', () => {
    const xml = buildGoogleMerchantFeed([], OPTS);
    expect(xml).toContain('<channel>');
    expect(xml).not.toContain('<item>');
  });
});
