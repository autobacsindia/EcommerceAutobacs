/**
 * Link previews (services/linkPreviewService.js) — the server fetches a URL a
 * person typed, so the guard against reaching our own network (SSRF) is the
 * thing these tests are mostly about. Then: a page's title/description come
 * back as plain text, redirects are re-checked, and size/time are bounded.
 */
import http from 'http';
import { isBlockedAddress, checkUrl, firstUrl, parsePreview, fetchPreview } from '../../../services/linkPreviewService.js';

describe('which addresses are never fetched', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    '64:ff9b::a00:1', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '104.18.2.3', '2606:4700::1111'])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe('which URLs are even considered', () => {
  it.each([
    'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://localhost/', 'http://api.localhost/',
    'http://printer.local/', 'http://metadata.google.internal/', 'http://127.0.0.1/', 'http://[::1]/', 'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data/', 'http://example.com:6379/', 'https://example.com:8443/', 'http://user:pw@example.com/', 'nonsense',
  ])('refuses %s', (url) => expect(checkUrl(url)).toBeNull());

  it.each(['https://example.com/a?b=1', 'http://example.com/', 'https://example.com:443/', 'http://8.8.8.8/'])('accepts %s', (url) =>
    expect(checkUrl(url)).not.toBeNull());
});

describe('firstUrl', () => {
  it('finds the first link and drops sentence punctuation', () => {
    expect(firstUrl('see https://example.com/page). thanks')).toBe('https://example.com/page');
    expect(firstUrl('a http://a.com b https://b.com')).toBe('http://a.com');
    expect(firstUrl('no links here')).toBeNull();
  });
});

describe('parsePreview', () => {
  const u = new URL('https://www.example.com/x');
  it('prefers Open Graph, falls back to <title> and the host', () => {
    expect(parsePreview('<head><meta property="og:title" content="Winch &amp; Rope"><meta name="description" content="Strong.">'
      + '<meta property="og:site_name" content="Shop"></head>', u))
      .toEqual({ url: 'https://www.example.com/x', title: 'Winch & Rope', description: 'Strong.', site: 'Shop' });
    expect(parsePreview('<html><head><title> Hello\n world </title></head>', u))
      .toEqual({ url: 'https://www.example.com/x', title: 'Hello world', description: '', site: 'example.com' });
  });

  it('returns text only — markup stays text, control characters go, lengths are capped', () => {
    const p = parsePreview(`<head><title>&lt;script&gt;x&lt;/script&gt;\u0007${'a'.repeat(400)}</title></head>`, u);
    expect(p.title.startsWith('<script>x</script>')).toBe(true);
    expect(p.title).not.toMatch(/\u0007/);
    expect(p.title.length).toBe(200);
  });

  it('a page with no title gives no card; tags after </head> are ignored', () => {
    expect(parsePreview('<head></head><body><title>late</title></body>', u)).toBeNull();
  });
});

describe('fetchPreview against a real (local) server', () => {
  let server;
  let base;
  const routes = {
    '/page': (res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<head><title>Roavion</title></head>'); },
    '/hop': (res) => { res.writeHead(302, { Location: '/page' }); res.end(); },
    '/to-metadata': (res) => { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); },
    '/loop': (res) => { res.writeHead(302, { Location: '/loop' }); res.end(); },
    '/json': (res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"title":"x"}'); },
    '/huge': (res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('<head><title>Big</title></head>'); res.end('x'.repeat(2 * 1024 * 1024)); },
    '/slow': () => { /* never answers */ },
  };
  beforeAll(async () => {
    server = http.createServer((req, res) => (routes[req.url] || ((r) => { r.writeHead(404); r.end(); }))(res));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://preview.test:${server.address().port}`;
  });
  afterAll(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));

  // The test server lives on 127.0.0.1 (blocked) and a non-default port (refused),
  // so the strict path is exercised first, then a test-only allowance reaches it.
  const toLocal = async () => [{ address: '127.0.0.1', family: 4 }];

  it('the strict path refuses it: a name that resolves to loopback is never fetched', async () => {
    expect(await fetchPreview('http://preview.test/page', { resolve: toLocal })).toBeNull();
  });

  describe('with a test-only allowance for the local server', () => {
    let opts;
    beforeAll(() => { opts = { resolve: toLocal, allowAddress: (a) => a === '127.0.0.1', extraPorts: [server.address().port] }; });

    it('reads the title, following a redirect', async () => {
      expect(await fetchPreview(`${base}/hop`, opts)).toEqual({ url: `${base}/page`, title: 'Roavion', description: '', site: 'preview.test' });
    });

    it('a redirect to the metadata address is refused', async () => {
      expect(await fetchPreview(`${base}/to-metadata`, opts)).toBeNull();
    });

    it('stops after a few redirects', async () => {
      expect(await fetchPreview(`${base}/loop`, opts)).toBeNull();
    });

    it('only HTML gives a card', async () => {
      expect(await fetchPreview(`${base}/json`, opts)).toBeNull();
    });

    it('reads no more than it needs from a huge page', async () => {
      expect((await fetchPreview(`${base}/huge`, opts)).title).toBe('Big');
    });

    it('gives up on a page that never answers', async () => {
      const t = Date.now();
      expect(await fetchPreview(`${base}/slow`, opts)).toBeNull();
      expect(Date.now() - t).toBeLessThan(6000);
    }, 10000);
  });
});
