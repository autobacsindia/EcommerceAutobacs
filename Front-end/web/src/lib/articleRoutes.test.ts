import {
  articleHref,
  articleListHref,
  blogPostPath,
  blogPostUrl,
  fixLegacyBlogCanonical,
  RESERVED_BLOG_SLUGS,
} from './articleRoutes';

const SITE = 'https://autobacsindia.com';
const SLUG = 'car-aftermarket-trends-in-india-2026-6-upgrades-owners-are-actually-buying';

describe('article URLs', () => {
  it('blog posts live under /blog', () => {
    expect(articleHref('blog', 'x')).toBe('/blog/x');
    expect(articleHref('blogs', 'x')).toBe('/blog/x');
    expect(blogPostPath('x')).toBe('/blog/x');
    expect(blogPostUrl('x', SITE)).toBe(`${SITE}/blog/x`);
    expect(articleListHref('blog')).toBe('/blog');
  });

  it('keeps the emoji slug exactly as stored', () => {
    expect(articleHref('blog', '%f0%9f%9a%97-how')).toBe('/blog/%f0%9f%9a%97-how');
  });

  it('news is unchanged', () => {
    expect(articleHref('news', 'x')).toBe('/media/news/x');
  });

  it('reserves the real /blog pages', () => {
    expect([...RESERVED_BLOG_SLUGS].sort()).toEqual(['gallery', 'videos']);
  });
});

describe('fixLegacyBlogCanonical', () => {
  const NEW = `${SITE}/blog/${SLUG}`;

  it.each([
    `https://autobacsindia.com/${SLUG}`,
    `https://autobacsindia.com/${SLUG}/`,
    `https://www.autobacsindia.com/${SLUG}`,
    `https://www.autobacsindia.com/${SLUG}/`,
    `http://www.autobacsindia.com/${SLUG}/`,
    `https://WWW.AutobacsIndia.com/${SLUG.toUpperCase()}/`,
    `/${SLUG}`,
    `/${SLUG}/`,
  ])('an override at the old root URL (%s) becomes the new /blog URL', (override) => {
    expect(fixLegacyBlogCanonical(override, SLUG, SITE)).toBe(NEW);
  });

  it.each([
    `https://autobacsindia.com/blog/${SLUG}`, // already right
    'https://autobacsindia.com/some-other-post', // a deliberate cross-canonical
    `https://example.com/${SLUG}`, // another site (the backend rejects these anyway)
    `https://autobacsindia.com/products/${SLUG}`,
  ])('any other override is left alone (%s)', (override) => {
    expect(fixLegacyBlogCanonical(override, SLUG, SITE)).toBe(override);
  });

  it.each([undefined, null, '', '   '])('no override stays no override (%p)', (v) => {
    expect(fixLegacyBlogCanonical(v, SLUG, SITE)).toBe(v);
  });

  it('also recognises the configured site host (e.g. a staging domain)', () => {
    expect(fixLegacyBlogCanonical(`https://staging.example.app/${SLUG}`, SLUG, 'https://staging.example.app')).toBe(
      `https://staging.example.app/blog/${SLUG}`,
    );
  });
});
