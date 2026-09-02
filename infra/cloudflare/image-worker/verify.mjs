#!/usr/bin/env node
/**
 * Post-deploy verification for the image Worker.
 *
 * Checks the things that are invisible until they go wrong: format negotiation,
 * and the delivery-side content-type clamp that contains non-image bytes in the
 * bucket. R2 does NOT enforce the Content-Type a presigned PUT was signed with,
 * so that clamp is the boundary stopping HTML from executing on this host — and
 * this host is a subdomain of the apex, which makes it a cookie-theft risk.
 *
 * Usage:  node verify.mjs [https://img.autobacsindia.com] [variant-key]
 * Exits non-zero on any failure so it can gate a deploy.
 */
const HOST = process.argv[2] || 'https://img.autobacsindia.com';
const KEY = process.argv[3] || '';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const head = async (path, accept) => {
  const res = await fetch(`${HOST}${path}`, { headers: accept ? { Accept: accept } : {} });
  return { status: res.status, ct: res.headers.get('content-type'), h: res.headers };
};

console.log(`\nVerifying ${HOST}\n`);

// 1. The Worker is the thing answering, not R2's bare custom domain.
{
  const res = await fetch(`${HOST}/`);
  const body = await res.text();
  check('Worker is serving the hostname', res.status === 404 && body.trim() === 'Not Found',
    `(got ${res.status} "${body.trim().slice(0, 24)}")`);
}

// 2. Method guard.
{
  const res = await fetch(`${HOST}/`, { method: 'POST' });
  check('POST is rejected', res.status === 405, `(got ${res.status})`);
}

// 3. Security headers on a real object — the XSS containment.
if (KEY) {
  const avif = await head(`/${KEY}`, 'image/avif,image/webp,image/*');
  check('AVIF served to an AVIF-capable client', avif.ct === 'image/avif', `(got ${avif.ct})`);

  const webp = await head(`/${KEY}`, 'image/webp,image/*');
  check('WebP served when AVIF is not accepted', webp.ct === 'image/webp', `(got ${webp.ct})`);

  const none = await head(`/${KEY}`, '');
  check('safe fallback with no Accept header', none.ct === 'image/webp', `(got ${none.ct})`);

  const nosniff = avif.h.get('x-content-type-options');
  const age = Number(avif.h.get('age') || 0);
  check('X-Content-Type-Options: nosniff present', nosniff === 'nosniff',
    nosniff === 'nosniff' ? '' : `(got ${nosniff || 'ABSENT'}${age ? `, cache age ${age}s` : ''})`);

  /*
    A missing header on a long-lived cache HIT means a pre-deploy entry is still
    being served, NOT that the deploy failed. Responses are stored immutable for
    a year and each PoP caches independently, so this shows up as the fix being
    applied on some edges and not others. The remedy is bumping CACHE_VERSION in
    the Worker, not redeploying the same code again.
  */
  if (nosniff !== 'nosniff' && age > 60) {
    console.log(`      ↳ served from a ${age}s-old cache entry — bump CACHE_VERSION in src/worker.js`);
  }

  check('Vary: Accept present', (avif.h.get('vary') || '').toLowerCase().includes('accept'),
    `(got ${avif.h.get('vary') || 'ABSENT'})`);

  check('immutable cache header', (avif.h.get('cache-control') || '').includes('immutable'),
    `(got ${avif.h.get('cache-control') || 'ABSENT'})`);
} else {
  console.log('  … pass a variant key as argv[3] to check negotiation + security headers');
  console.log('    e.g. node verify.mjs https://img.autobacsindia.com variants/autobacs/products/<id>/<name>/w640');
}

console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
