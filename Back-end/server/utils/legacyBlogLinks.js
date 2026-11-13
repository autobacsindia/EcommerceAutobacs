/**
 * Pure helpers for moving blog links from the site root (/<slug>) to /blog/<slug>
 * (2026-11). Used by scripts/rewrite-legacy-blog-links.js; kept here so they are
 * unit-tested without a database.
 *
 * Only links to OUR site (relative, or autobacsindia.com / www.) whose whole path
 * is one known blog slug are touched. Everything else — products, categories,
 * other dead WordPress paths, other sites — is returned byte-for-byte unchanged.
 */

const OWN_HOSTS = new Set(['autobacsindia.com', 'www.autobacsindia.com']);
const PARSE_BASE = 'https://www.autobacsindia.com';

/**
 * If `href` points at a blog post's old root URL, the slug (lowercase), else null.
 * @param {string} href
 * @param {Set<string>} blogSlugs lowercase slugs of blog articles
 */
export function legacyBlogSlugOf(href, blogSlugs) {
  const raw = String(href ?? '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return null;
  const relative = raw.startsWith('/');
  if (!relative && !/^https?:\/\//i.test(raw)) return null;
  let url;
  try {
    url = new URL(raw, PARSE_BASE);
  } catch {
    return null;
  }
  if (!relative && !OWN_HOSTS.has(url.hostname.toLowerCase())) return null;
  const segment = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!segment || segment.includes('/')) return null;
  if (blogSlugs.has(segment)) return segment;
  // The emoji post: stored as percent-encoded text, linked either way.
  try {
    const decodedOnce = decodeURIComponent(segment);
    if (blogSlugs.has(decodedOnce)) return decodedOnce;
  } catch { /* malformed escape */ }
  return null;
}

const HREF_RE = /(\bhref\s*=\s*)(["'])([^"']*)\2/gi;

/**
 * Rewrite every old-root blog link in an HTML string to /blog/<slug>, keeping any
 * ?query and #fragment. Site-relative on purpose: it works on any host, before
 * and after the domain cutover.
 * @returns {{ html: string, changes: Array<{ from: string, to: string }> }}
 */
export function rewriteLegacyBlogLinks(html, blogSlugs) {
  const changes = [];
  if (typeof html !== 'string' || !html) return { html, changes };
  const out = html.replace(HREF_RE, (match, attr, quote, href) => {
    const slug = legacyBlogSlugOf(href, blogSlugs);
    if (!slug) return match;
    const url = new URL(href.trim(), PARSE_BASE);
    const to = `/blog/${slug}${url.search}${url.hash}`;
    changes.push({ from: href, to });
    return `${attr}${quote}${to}${quote}`;
  });
  return { html: out, changes };
}

/**
 * Is this canonical override just the post's own OLD root URL? Then it should be
 * cleared, so the page canonicalises to itself at /blog/<slug>.
 */
export function isOwnLegacyCanonical(canonical, slug) {
  if (!canonical || !slug) return false;
  return legacyBlogSlugOf(canonical, new Set([String(slug).toLowerCase()])) === String(slug).toLowerCase();
}
