/**
 * Category → size class guess (utils/categoryShippingClass.js). Slugs are real ones
 * from the live catalogue (Nov 2026).
 */
import {
  classFromCategorySlugs, slugsWithAncestors, DEFAULT_CATEGORY_CLASS,
} from '../../../utils/categoryShippingClass.js';

describe('classFromCategorySlugs', () => {
  it.each([
    [['exterior', 'conversion-kit', 'body-kits'], 'xl'],     // the Maybach W223 kit
    [['body-kits', 'facelift-conversion-kit'], 'xl'],
    [['protection-kit', 'bullbar'], 'xl'],
    [['roof-top', 'roof-top-tent'], 'xl'],
    [['exterior', 'side-step'], 'large'],
    [['exterior', 'electric-side-steps'], 'large'],
    [['suspension', 'lift-kit'], 'large'],
    [['interior', 'seat'], 'large'],
    [['lighting', 'headlight'], 'medium'],
    [['interior', 'steering-wheel'], 'medium'],
    [['interior', 'seat-cover'], 'medium'],                    // "=seat" is exact: a cover is not a seat
    [['performance', 'air-filters'], 'small'],
    [['accessories', 'key-case'], 'small'],
  ])('%j → %s', (slugs, cls) => {
    expect(classFromCategorySlugs(slugs)).toBe(cls);
  });

  it('the biggest matching class wins, whatever the order', () => {
    expect(classFromCategorySlugs(['air-filters', 'bumper'])).toBe('xl');
    expect(classFromCategorySlugs(['bumper', 'air-filters'])).toBe('xl');
    expect(classFromCategorySlugs(['key-case', 'lighting'])).toBe('small'); // lighting has no rule
  });

  it('no categories, or none that match → medium (never the ½ kg minimum)', () => {
    expect(DEFAULT_CATEGORY_CLASS).toBe('medium');
    expect(classFromCategorySlugs([])).toBe('medium');
    expect(classFromCategorySlugs(undefined)).toBe('medium');
    expect(classFromCategorySlugs(['exterior', 'mirrors'])).toBe('medium');
  });
});

describe('slugsWithAncestors', () => {
  const index = new Map([
    ['bk', { slug: 'body-kits', parent: null }],
    ['ck', { slug: 'conversion-kit', parent: 'bk' }],
    ['ex', { slug: 'exterior', parent: null }],
    ['loopA', { slug: 'a', parent: 'loopB' }],
    ['loopB', { slug: 'b', parent: 'loopA' }],
  ]);

  it('adds every parent slug, once', () => {
    expect(slugsWithAncestors(['ck', 'ex'], index).sort()).toEqual(['body-kits', 'conversion-kit', 'exterior']);
    expect(slugsWithAncestors(['ck', 'bk'], index).sort()).toEqual(['body-kits', 'conversion-kit']);
  });

  it('ignores unknown ids and survives a parent cycle', () => {
    expect(slugsWithAncestors(['nope'], index)).toEqual([]);
    expect(slugsWithAncestors(['loopA'], index).sort()).toEqual(['a', 'b']);
    expect(slugsWithAncestors(null, index)).toEqual([]);
  });
});
