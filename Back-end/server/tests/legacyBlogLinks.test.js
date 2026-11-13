/**
 * The pure rewrite behind scripts/rewrite-legacy-blog-links.js (blog posts moved
 * from /<slug> to /blog/<slug>, 2026-11). Pins the 4 real live links, the
 * canonical-override case, and that nothing else in an article is touched.
 */
import { legacyBlogSlugOf, rewriteLegacyBlogLinks, isOwnLegacyCanonical } from '../utils/legacyBlogLinks.js';

const OFFROAD = 'essential-off-road-accessories-to-elevate-your-adventure-game';
const PERF = 'automotive-performance-upgrade-elevating-speed-handling-and-efficiency';
const EMOJI = '%f0%9f%9a%97-how-to-create-a-virtual-wide-body-kit-render-using-chatgpt';
const SLUGS = new Set([OFFROAD, PERF, EMOJI]);

describe('legacyBlogSlugOf', () => {
  it.each([
    [`https://autobacsindia.com/${OFFROAD}/`, OFFROAD],
    [`https://www.autobacsindia.com/${OFFROAD}`, OFFROAD],
    [`http://autobacsindia.com/${PERF}/`, PERF],
    [`/${PERF}/`, PERF],
    [`/${PERF}`, PERF],
    [`/${PERF.toUpperCase()}/`, PERF],
    [`/${EMOJI}`, EMOJI],
    [`/${encodeURIComponent(EMOJI)}`, EMOJI],
  ])('%s → %s', (href, slug) => {
    expect(legacyBlogSlugOf(href, SLUGS)).toBe(slug);
  });

  it.each([
    `/blog/${OFFROAD}`, // already moved
    `https://example.com/${OFFROAD}/`, // another site
    '/collections/bull-bars/', // dead WordPress path, out of scope
    '/?s=winch&post_type=product',
    '/product/some-winch/',
    '/not-a-post',
    '#section',
    'mailto:info@autobacsindia.com',
    `//autobacsindia.com/${OFFROAD}`, // protocol-relative: leave for a human
    '',
  ])('%s is not a legacy blog link', (href) => {
    expect(legacyBlogSlugOf(href, SLUGS)).toBeNull();
  });
});

describe('rewriteLegacyBlogLinks', () => {
  it('rewrites the live links and nothing else', () => {
    const html = [
      `<p>See <a href="https://autobacsindia.com/${OFFROAD}/">this guide</a> and`,
      ` <a class="x" href='/${PERF}/?utm=1#top'>that one</a>.</p>`,
      `<a href="/collections/bull-bars/">bull bars</a>`,
      `<img src="https://autobacsindia.com/${OFFROAD}/">`,
    ].join('');
    const { html: out, changes } = rewriteLegacyBlogLinks(html, SLUGS);
    expect(out).toBe([
      `<p>See <a href="/blog/${OFFROAD}">this guide</a> and`,
      ` <a class="x" href='/blog/${PERF}?utm=1#top'>that one</a>.</p>`,
      `<a href="/collections/bull-bars/">bull bars</a>`,
      `<img src="https://autobacsindia.com/${OFFROAD}/">`,
    ].join(''));
    expect(changes).toHaveLength(2);
  });

  it('is idempotent: a second run changes nothing', () => {
    const once = rewriteLegacyBlogLinks(`<a href="/${PERF}/">x</a>`, SLUGS).html;
    const twice = rewriteLegacyBlogLinks(once, SLUGS);
    expect(twice.html).toBe(once);
    expect(twice.changes).toEqual([]);
  });

  it.each([undefined, null, ''])('tolerates empty content (%p)', (v) => {
    expect(rewriteLegacyBlogLinks(v, SLUGS)).toEqual({ html: v, changes: [] });
  });
});

describe('isOwnLegacyCanonical', () => {
  const SLUG = 'car-aftermarket-trends-in-india-2026-6-upgrades-owners-are-actually-buying';
  it.each([
    `https://www.autobacsindia.com/${SLUG}`,
    `https://autobacsindia.com/${SLUG}/`,
  ])('%s is the post\'s own old URL', (c) => {
    expect(isOwnLegacyCanonical(c, SLUG)).toBe(true);
  });
  it.each([
    `https://www.autobacsindia.com/blog/${SLUG}`,
    'https://www.autobacsindia.com/another-post',
    '',
    undefined,
  ])('%s is not', (c) => {
    expect(isOwnLegacyCanonical(c, SLUG)).toBe(false);
  });
});
