/**
 * CSP — the directives features silently depend on.
 *
 * Direct browser→storage uploads (admin images, careers videos/CVs, return
 * evidence) are the only part of the app whose CSP dependency is invisible until
 * it breaks: the browser refuses the request before it leaves the page, and all
 * the UI can show is a generic failure. The same is true of the script nonce.
 * So the entries those paths need are pinned rather than left to review.
 */
import { buildCsp } from './csp';

const directive = (csp: string, name: string) =>
  csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '';

describe('connect-src', () => {
  test('allows the R2 upload origin', () => {
    // Presigned PUTs go to the S3 endpoint. A private bucket has no custom
    // domain by design, so there is no narrower host available.
    expect(directive(buildCsp('n0nc3'), 'connect-src')).toMatch(/r2\.cloudflarestorage\.com/);
  });

  test('still allows Cloudinary while both stores hold live assets', () => {
    expect(directive(buildCsp('n0nc3'), 'connect-src')).toContain('https://api.cloudinary.com');
  });

  test('keeps the page itself as an allowed origin', () => {
    expect(directive(buildCsp('n0nc3'), 'connect-src')).toContain("'self'");
  });
});

/*
  R2 presigns VIRTUAL-HOSTED style — the bucket is a subdomain of the account:
    https://autobacs-private.<account-id>.r2.cloudflarestorage.com
  A CSP source matches the host EXACTLY unless it carries a wildcard, so a bare
  account endpoint matches neither bucket and blocks every upload before the
  request leaves the page. These tests approximate the browser's host matching
  so a value that looks right but matches nothing cannot ship.
*/
describe('connect-src actually matches a real R2 bucket host', () => {
  const REAL_HOSTS = [
    'https://autobacs-public.93c6c3be917e1308dfdd4745b4316571.r2.cloudflarestorage.com',
    'https://autobacs-private.93c6c3be917e1308dfdd4745b4316571.r2.cloudflarestorage.com',
  ];

  /** A CSP source expression: `*` matches one or more leading labels. */
  const allows = (source: string, url: string) => {
    const host = new URL(url).host;
    const MARK = 'wildcard.';
    const pattern = new URL(source.replace('*.', MARK)).host;
    if (!pattern.startsWith(MARK)) return host === pattern;
    // CSP's `*.` matches one OR MORE leading labels, so a.b.example.com is
    // covered by *.example.com — which is what lets one source cover both buckets.
    const base = pattern.slice(MARK.length);
    return host === base || host.endsWith(`.${base}`);
  };

  const r2Sources = () =>
    directive(buildCsp('n0nc3'), 'connect-src')
      .split(/\s+/)
      .filter((t) => t.includes('r2.cloudflarestorage.com'));

  test.each(REAL_HOSTS)('allows %s', (host) => {
    expect(r2Sources().some((src) => allows(src, host))).toBe(true);
  });

  /*
    The exact mistake this guards: the account endpoint without a wildcard reads
    as correct and matches nothing, because the bucket is a separate label.
  */
  test('a bare account endpoint would NOT match — which is why the wildcard is required', () => {
    const bare = 'https://93c6c3be917e1308dfdd4745b4316571.r2.cloudflarestorage.com';
    for (const host of REAL_HOSTS) expect(allows(bare, host)).toBe(false);
  });
});

describe('img-src', () => {
  /*
    The R2 delivery host. Products render through it once Phase 6 rewrites the
    stored URLs; without this every product image is blocked at once.
  */
  test('allows both image hosts during the migration', () => {
    const img = directive(buildCsp('n0nc3'), 'img-src');
    expect(img).toContain('https://img.autobacsindia.com');
    expect(img).toContain('https://res.cloudinary.com');
  });
});

describe('script-src', () => {
  /*
    The nonce is what makes 'strict-dynamic' safe here. If it stopped reaching
    the header the policy would still look well-formed while permitting nothing —
    the kind of breakage that gets "fixed" by relaxing the policy.
  */
  test('carries the per-request nonce', () => {
    expect(buildCsp('abc123')).toContain("'nonce-abc123'");
    expect(buildCsp('different')).not.toContain("'nonce-abc123'");
  });

  test('never allows unsafe-eval in production', () => {
    const prev = process.env.NODE_ENV;
    try {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
      expect(directive(buildCsp('n0nc3'), 'script-src')).not.toContain("'unsafe-eval'");
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: prev, configurable: true });
    }
  });
});

describe('the always-on hardening', () => {
  test('blocks plugins and framing outright', () => {
    const csp = buildCsp('n0nc3');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});

/*
  Tags delivered by the GTM container (GTM-PK3BVQR9).

  This is the failure mode 'strict-dynamic' creates: it trusts whatever GTM
  injects, so a new tag's SCRIPT always runs and GTM Preview reports the tag as
  firing — while the endpoints it posts data to are blocked by img-src /
  connect-src and the tool records nothing. Microsoft Clarity ran that way in
  production on 2026-09-03. The URLs below are the ones Chrome actually reported
  as blocked, so this pins the fix to observed traffic rather than a guess.
*/
describe('tags delivered through GTM', () => {
  /** Approximates the browser's host matching; `*.` covers one or more labels. */
  const allows = (directiveValue: string, url: string) => {
    const host = new URL(url).host;
    return directiveValue.split(/\s+/).some((source) => {
      if (!source.startsWith('https://')) return false;
      const pattern = source.slice('https://'.length);
      if (!pattern.startsWith('*.')) return host === pattern;
      const base = pattern.slice(2);
      return host === base || host.endsWith(`.${base}`);
    });
  };

  const csp = () => buildCsp('n0nc3');

  test('img-src allows the Clarity pixel that was blocked in production', () => {
    expect(allows(directive(csp(), 'img-src'), 'https://c.clarity.ms/c.gif')).toBe(true);
  });

  test('img-src allows the Bing host that pixel REDIRECTS to', () => {
    // c.clarity.ms/c.gif → 302 → c.bing.com/c.gif. CSP checks every hop, and the
    // violation is reported against the original url — so allowing clarity.ms
    // alone still blocks the pixel while making it look like the wildcard failed.
    expect(allows(directive(csp(), 'img-src'), 'https://c.bing.com/c.gif')).toBe(true);
  });

  test.each([
    'https://l.clarity.ms/collect',
    'https://k.clarity.ms/collect',
    'https://e.clarity.ms/collect',
  ])('connect-src allows the Clarity ingest host %s', (url) => {
    // Clarity shards ingest across single-letter region hosts, so pinning one
    // host would break the day a visitor is routed to a different shard.
    expect(allows(directive(csp(), 'connect-src'), url)).toBe(true);
  });

  test('script-src still lists the tag host for browsers without strict-dynamic', () => {
    expect(allows(directive(csp(), 'script-src'), 'https://www.clarity.ms/tag/abc123')).toBe(true);
  });

  /**
   * A CSP host source matches ONE exact host: "www.google.com" does not cover
   * "google.com". Chrome reported this on prod on 2026-09-04:
   *
   *   Refused to connect to 'https://google.com/ccm/form-data/<ads-id>'
   *
   * That is the Google tag's enhanced-conversions form-data endpoint, dropped on
   * every product page while the www host sat in the list looking like it covered
   * it — the same shape as the clarity.ms → c.bing.com redirect above, and just
   * as silent.
   */
  test.each([
    ['connect-src', 'https://google.com/ccm/form-data/11434499615'],
    ['connect-src', 'https://google.co.in/ccm/form-data/11434499615'],
    ['img-src', 'https://google.com/pagead/1p-user-list/11434499615/'],
    ['img-src', 'https://google.co.in/pagead/1p-user-list/11434499615/'],
  ])('%s allows the APEX Google host %s', (name, url) => {
    expect(allows(directive(csp(), name), url)).toBe(true);
  });

  test('the www Google hosts are still allowed alongside the apex ones', () => {
    // Adding the apex must not have replaced the www entries: both are used.
    expect(allows(directive(csp(), 'connect-src'), 'https://www.google.com/ccm/collect')).toBe(true);
    expect(allows(directive(csp(), 'img-src'), 'https://www.google.co.in/pagead/1p-user-list/x/')).toBe(true);
  });

  test('the GTM noscript iframe is framable', () => {
    // Only JS-disabled visitors hit this, so a regression here is invisible.
    expect(allows(directive(csp(), 'frame-src'), 'https://www.googletagmanager.com/ns.html?id=x')).toBe(true);
  });
});
