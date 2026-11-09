import { articleSlugForApi } from './articleSlug';

describe('articleSlugForApi', () => {
  it('leaves an ordinary slug alone', () => {
    expect(articleSlugForApi('car-care-tips')).toBe('car-care-tips');
  });

  it('survives one round of server decoding as the stored literal', () => {
    const stored = '%f0%9f%9a%97-wide-body';
    expect(decodeURIComponent(articleSlugForApi(stored))).toBe(stored);
  });

  it('matches the stored lowercase slug when the browser sent uppercase hex', () => {
    expect(decodeURIComponent(articleSlugForApi('%F0%9F%9A%97-wide-body'))).toBe('%f0%9f%9a%97-wide-body');
  });
});
