import { resolveSearchTerm } from '../../../utils/searchHelpers.js';

/**
 * The `q` vs `search` duality, pinned.
 *
 * The storefront sends `?q=`. Large parts of the backend were written against
 * `search`, and until 2026-09-16 exactly ONE place reconciled the two. Every other
 * consumer silently ignored the name it was not looking for, which produced three
 * separate bugs all wearing the face "returns the entire catalogue":
 *
 *   1. the filter sidebar counted all 930 products on every search;
 *   2. the MongoDB facet fallback did the same;
 *   3. the MongoDB grid fallback dropped `?q=` — latent, and it would have turned
 *      an Atlas outage into "every search returns everything".
 *
 * These tests exist so a fourth consumer cannot be added with the same omission.
 */

describe('resolveSearchTerm — one precedence, one place', () => {
  it('reads the `q` the storefront actually sends', () => {
    expect(resolveSearchTerm({ q: 'winch' })).toBe('winch');
  });

  it('still reads `search`, which older internal callers use', () => {
    expect(resolveSearchTerm({ search: 'winch' })).toBe('winch');
  });

  it('prefers `q` when both are present, matching the pre-existing engine branch', () => {
    expect(resolveSearchTerm({ q: 'winch', search: 'spoiler' })).toBe('winch');
  });

  it('returns an empty STRING, never null/undefined, so callers need no guard', () => {
    // A filters-only browse must be falsy-but-safe: `.trim()` on the result of this
    // helper is a thing callers will do.
    expect(resolveSearchTerm({})).toBe('');
    expect(resolveSearchTerm()).toBe('');
    expect(resolveSearchTerm(null)).toBe('');
  });

  it('ignores a non-string value rather than passing it downstream', () => {
    // `?q=a&q=b` arrives as an array, and a regex built from an array is not a
    // failure anyone would enjoy debugging.
    expect(resolveSearchTerm({ q: ['a', 'b'] })).toBe('');
    expect(resolveSearchTerm({ q: 42 })).toBe('');
    expect(resolveSearchTerm({ q: { evil: true } })).toBe('');
  });

  it('falls through to `search` when `q` is present but empty', () => {
    // `?q=&search=winch` — an empty q is not an instruction to search for nothing.
    expect(resolveSearchTerm({ q: '', search: 'winch' })).toBe('winch');
  });
});
