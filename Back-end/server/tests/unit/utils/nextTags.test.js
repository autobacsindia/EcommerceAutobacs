/**
 * Next.js Data Cache tag builders (utils/nextTags.js).
 *
 * These guard the bug class that made on-demand revalidation silently useless:
 * a write path emitting a tag the revalidator's allowlist drops, or a bulk path
 * emitting only collection tags so every detail page stayed stale.
 */

import { jest } from '@jest/globals';
import {
  productTags,
  productBulkTags,
  categoryTags,
  careersTags,
  articleTags,
} from '../../../utils/nextTags.js';

// Mirrors ALLOWED_PREFIXES in services/frontendRevalidator.js. Duplicated on
// purpose: if someone narrows the allowlist without updating the builders, the
// contract test below fails instead of revalidation going quietly dead.
const ALLOWED_PREFIXES = ['home:', 'product:', 'category:', 'nav:', 'seo:', 'blog:', 'careers:'];
const MAX_TAGS = 20; // must match the revalidator's cap

const isAllowed = (tag) => ALLOWED_PREFIXES.some((p) => tag.startsWith(p));

describe('every builder emits only allowlisted tags', () => {
  const cases = [
    ['productTags', productTags({ slug: 'brake-pad' })],
    ['productTags (no slug)', productTags(null)],
    ['productBulkTags', productBulkTags([{ slug: 'a' }, { slug: 'b' }])],
    ['categoryTags', categoryTags({ slug: 'brakes' })],
    ['categoryTags (no slug)', categoryTags(null)],
    ['careersTags', careersTags()],
    ['articleTags', articleTags({ slug: 'post', type: 'blog' })],
  ];

  it.each(cases)('%s', (_name, tags) => {
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(isAllowed(tag)).toBe(true);
  });
});

describe('productTags', () => {
  it('refreshes the home shelf AND the catalog listing, not just one', () => {
    // The catalog listing tag is the one that was missing entirely — /products
    // served up to 300s stale after every admin edit.
    expect(productTags({ slug: 'x' })).toEqual(
      expect.arrayContaining(['home:products', 'product:list', 'product:x'])
    );
  });

  it('omits the PDP tag when the slug is unknown rather than emitting "product:undefined"', () => {
    expect(productTags({})).toEqual(['home:products', 'product:list']);
    expect(productTags(null)).toEqual(['home:products', 'product:list']);
  });
});

describe('productBulkTags', () => {
  it('puts collection tags in the first request batch', () => {
    // The revalidator sends tags in batches of MAX_TAGS and stops at a total
    // ceiling, so the coarse tags must lead or a large bulk write could push
    // them past it. (Batching itself is tested in frontendRevalidator.test.js.)
    const many = Array.from({ length: 200 }, (_, i) => ({ slug: `p-${i}` }));
    const firstBatch = [...new Set(productBulkTags(many))].filter(isAllowed).slice(0, MAX_TAGS);

    expect(firstBatch[0]).toBe('home:products');
    expect(firstBatch[1]).toBe('product:list');
    expect(firstBatch).toContain('product:p-0');
  });

  it('emits a tag for EVERY product, leaving truncation policy to the revalidator', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ slug: `p-${i}` }));
    const tags = productBulkTags(many);
    expect(tags).toHaveLength(202); // 2 collection + 200 PDP
    expect(tags).toContain('product:p-199');
  });

  it('skips rows with no slug instead of emitting a broken tag', () => {
    expect(productBulkTags([{ slug: 'a' }, {}, null, { slug: '' }])).toEqual([
      'home:products',
      'product:list',
      'product:a',
    ]);
  });

  it('still emits collection tags for an empty batch', () => {
    expect(productBulkTags([])).toEqual(['home:products', 'product:list']);
    expect(productBulkTags()).toEqual(['home:products', 'product:list']);
  });
});

describe('categoryTags', () => {
  it('covers the home grid, the nav menu and the /categories listing', () => {
    expect(categoryTags({ slug: 'brakes' })).toEqual([
      'home:categories',
      'nav:categories',
      'category:list',
      'category:brakes',
    ]);
  });
});

describe('articleTags', () => {
  it('refreshes the journal shelf and the article page for a blog post', () => {
    expect(articleTags({ slug: 'my-post', type: 'blog' })).toEqual(['home:journal', 'blog:my-post']);
  });

  it('emits nothing for non-blog media, which has no server-cached page', () => {
    expect(articleTags({ slug: 'presser', type: 'news' })).toEqual([]);
    expect(articleTags({ slug: 'clip', type: 'video' })).toEqual([]);
  });

  it('treats an unknown type as a blog so a publish is never silently missed', () => {
    expect(articleTags({ slug: 'x' })).toEqual(['home:journal', 'blog:x']);
  });
});
