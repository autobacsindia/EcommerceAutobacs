import { jest } from '@jest/globals';
import {
  buildMetaCatalogFeed,
  buildItemsForProduct,
  feedId,
  variantFeedId,
  itemGroupId,
} from '../../../services/metaFeedService.js';

// The single most important property of this feed is retailer_id CONTINUITY with
// the old Facebook-for-WooCommerce catalogue, so Meta updates existing items
// instead of duplicating them. These tests lock the confirmed scheme:
//   simple  id            = String(wpId)
//   variant id            = String(wpVariationId)
//   variable item_group_id = "wc_post_id_" + wpId
// plus the price/sale, availability, image, and escaping mapping.

const OPTS = { siteUrl: 'https://autobacsindia.com', defaultBrand: 'Autobacs India' };

const img = (url, isPrimary = false) => ({ url, isPrimary });

describe('metaFeedService — retailer_id scheme', () => {
  test('simple product id is the bare Woo post id', () => {
    expect(feedId({ wpId: 11466, _id: 'x' })).toBe('11466');
  });

  test('variant id is the bare Woo variation id; group id is wc_post_id_<wpId>', () => {
    const product = { wpId: 11466, _id: 'x' };
    expect(variantFeedId(product, { wpVariationId: 11469, _id: 'v' })).toBe('11469');
    expect(itemGroupId(product)).toBe('wc_post_id_11466');
  });

  test('native (post-migration) product with no wpId gets a deterministic ab_ fallback', () => {
    expect(feedId({ _id: 'abc123' })).toBe('ab_abc123');
    expect(itemGroupId({ _id: 'abc123' })).toBe('ab_abc123');
    // The variant's own ObjectId is globally unique, so it stands alone — pairing
    // it with the parent pushed the id past Google's 50-char cap. See the
    // 50-character budget in utils/metaCatalogId.js.
    expect(variantFeedId({ _id: 'abc123' }, { _id: 'v9' })).toBe('ab_v9');
    // Only a variant with no _id at all falls back to the parent-qualified form.
    expect(variantFeedId({ _id: 'abc123' }, {})).toBe('ab_abc123_undefined');
  });
});

describe('metaFeedService — item mapping', () => {
  test('simple product maps to one row with price + availability + no group id', () => {
    const [item] = buildItemsForProduct(
      {
        _id: 'a',
        wpId: 500,
        name: 'Roof Rack',
        shortDescription: 'Sturdy rack',
        slug: 'roof-rack',
        price: 45000,
        stock: 'in',
        brand: 'Option4WD',
        images: [img('https://cdn/x.jpg', true)],
        productType: 'simple',
      },
      OPTS
    );
    expect(item.id).toBe('500');
    expect(item.itemGroupId).toBeNull();
    expect(item.price).toBe('45000.00 INR');
    expect(item.salePrice).toBeNull();
    expect(item.availability).toBe('in stock');
    expect(item.brand).toBe('Option4WD');
    expect(item.link).toBe('https://autobacsindia.com/products/roof-rack');
  });

  test('variable product yields one row per variant sharing the group id', () => {
    const items = buildItemsForProduct(
      {
        _id: 'b',
        wpId: 11466,
        name: 'Upper Arm',
        slug: 'upper-arm',
        price: 45000,
        stock: 'in',
        images: [img('https://cdn/y.jpg', true)],
        productType: 'variable',
        variants: [
          { _id: 'v1', wpVariationId: 11469, label: 'Blue', price: 45000, stock: 'in' },
          { _id: 'v2', wpVariationId: 11475, label: 'Grey', price: 47000, stock: 'out' },
        ],
      },
      OPTS
    );
    expect(items.map((i) => i.id)).toEqual(['11469', '11475']);
    expect(items.every((i) => i.itemGroupId === 'wc_post_id_11466')).toBe(true);
    expect(items[0].title).toBe('Upper Arm - Blue');
    expect(items[0].customLabel0).toBe('Blue');
    expect(items[1].price).toBe('47000.00 INR');
    expect(items[1].availability).toBe('out of stock');
  });

  test('active sale emits price=original and sale_price=current', () => {
    const [item] = buildItemsForProduct(
      {
        _id: 'c',
        wpId: 1,
        name: 'Filter',
        slug: 'filter',
        price: 800,
        originalPrice: 1000,
        stock: 'low',
        images: [img('https://cdn/z.jpg')],
        productType: 'simple',
      },
      OPTS
    );
    expect(item.price).toBe('1000.00 INR');
    expect(item.salePrice).toBe('800.00 INR');
    expect(item.availability).toBe('in stock'); // low → in stock
  });

  test('expired sale window reverts price up and drops sale_price', () => {
    const [item] = buildItemsForProduct(
      {
        _id: 'd',
        wpId: 2,
        name: 'Pad',
        slug: 'pad',
        price: 800,
        originalPrice: 1000,
        saleEndsAt: new Date(Date.now() - 60_000), // ended a minute ago
        stock: 'in',
        images: [img('https://cdn/p.jpg')],
        productType: 'simple',
      },
      OPTS
    );
    expect(item.price).toBe('1000.00 INR');
    expect(item.salePrice).toBeNull();
  });

  test('backorder maps to "available for order"; product with no image is skipped', () => {
    const [back] = buildItemsForProduct(
      { _id: 'e', wpId: 3, name: 'X', slug: 'x', price: 100, stock: 'backorder', images: [img('u')], productType: 'simple' },
      OPTS
    );
    expect(back.availability).toBe('available for order');

    const none = buildItemsForProduct(
      { _id: 'f', wpId: 4, name: 'Y', slug: 'y', price: 100, stock: 'in', images: [], productType: 'simple' },
      OPTS
    );
    expect(none).toEqual([]);
  });
});

describe('metaFeedService — RSS document', () => {
  const products = [
    {
      _id: 'a',
      wpId: 500,
      name: 'Rack & Pinion "Pro"',
      shortDescription: 'A & B <b>bold</b>',
      slug: 'rack',
      price: 45000,
      stock: 'in',
      brand: 'Acme',
      images: [img('https://cdn/x.jpg', true)],
      productType: 'simple',
    },
  ];

  test('produces valid RSS with the g: namespace and escaped fields', () => {
    const xml = buildMetaCatalogFeed(products, OPTS);
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(xml).toContain('<g:id>500</g:id>');
    expect(xml).toContain('<g:price>45000.00 INR</g:price>');
    // XML-special chars escaped in title and HTML stripped from description
    expect(xml).toContain('<g:title>Rack &amp; Pinion &quot;Pro&quot;</g:title>');
    expect(xml).toContain('<g:description>A &amp; B bold</g:description>');
    // No GTIN/MPN → identifier_exists=no
    expect(xml).toContain('<g:identifier_exists>no</g:identifier_exists>');
  });

  test('empty catalogue still yields a well-formed channel', () => {
    const xml = buildMetaCatalogFeed([], OPTS);
    expect(xml).toContain('<channel>');
    expect(xml).toContain('</rss>');
    expect(xml).not.toContain('<item>');
  });
});
