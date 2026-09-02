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
