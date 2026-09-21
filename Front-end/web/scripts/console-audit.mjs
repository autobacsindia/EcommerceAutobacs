/**
 * Browser console audit — the checks no server-side test can perform.
 *
 * WHY THIS EXISTS
 * A Content-Security-Policy violation produces NO server-side signal. The page
 * returns 200, the headers look deliberate, curl is happy, CI is green — and the
 * browser has silently refused to run a script, connect to an endpoint, or frame
 * an iframe. Every CSP bug this project has hit was found by a human opening
 * DevTools, and each one had been live for an unknown length of time:
 *
 *   - gtag.js blocked on every strict route (begin_checkout never fired)
 *   - analytics.google.com blocked — the APEX host, while the wildcard was
 *     allowed, so all GA4 page_views were dropped
 *   - facebook.com blocked in form-action and frame-src (Meta Pixel degraded)
 *   - stats.g.doubleclick.net blocked (Google Signals)
 *   - React #418 hydration failure on every page load, which makes React discard
 *     the server-rendered tree and re-render it on the client
 *
 * None of those are visible without a real browser. This script is that browser,
 * runnable on demand and in CI.
 *
 * USAGE
 *   npm run console-audit                        # production
 *   npm run console-audit -- --url=http://localhost:3000
 *   npm run console-audit -- --paths=/,/cart
 *
 * Exits non-zero if any CSP violation or uncaught page error is found, so it can
 * gate a deploy.
 *
 * ── KNOWN-GOOD EXCEPTIONS ───────────────────────────────────────────────────
 * The Meta Pixel tries to reach randomised first-party relay hosts
 * (*.on.aws, *.run.app). Those stay BLOCKED on purpose: allowlisting them means
 * trusting every AWS Lambda and Cloud Run URL on the internet, which is an open
 * exfiltration channel for any XSS. facebook.com/tr still works, so no events
 * are lost. They are ignored here rather than "fixed" — to silence them for
 * real, disable the feature in Meta Events Manager.
 */

import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const BASE = arg('url', 'https://www.autobacsindia.com').replace(/\/+$/, '');
const PATHS = arg('paths', '/,/privacy,/products,/categories').split(',');
const SETTLE_MS = Number(arg('settle', 8000));

/** Violations that are deliberate. See the header note. */
const IGNORED_BLOCKED = [/\.on\.aws/, /\.run\.app/];

const browser = await chromium.launch();
let failures = 0;

for (const path of PATHS) {
  // A fresh context per page: no extensions, no shared cookies, no cache
  // carry-over. Extensions are a common source of phantom hydration errors, so
  // the clean profile is what makes a reported #418 trustworthy.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const pageErrors = [];
  const sent = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('request', (r) => sent.push(r.url()));

  // The securitypolicyviolation event is the authoritative signal. Scraping the
  // console for "Refused to" misses violations the console coalesces.
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI }),
    );
  });

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
  // Tags fire asynchronously well after networkidle; without this wait the
  // audit reports a clean page that is about to violate.
  await page.waitForTimeout(SETTLE_MS);

  const csp = (await page.evaluate(() => window.__csp || [])).filter(
    (v) => !IGNORED_BLOCKED.some((re) => re.test(v.blocked)),
  );
  const nonces = await page.evaluate(() => ({
    scripts: document.querySelectorAll('script').length,
    nonced: document.querySelectorAll('script[nonce]').length,
  }));

  // A CSP that names a nonce over HTML carrying none blocks EVERY script while
  // returning a healthy-looking 200. This is the single worst failure mode here.
  const cspHeader = await page
    .goto(`${BASE}${path}`, { waitUntil: 'commit' })
    .then((r) => r?.headers()['content-security-policy'] || '')
    .catch(() => '');
  const noncedCsp = /nonce-/.test(cspHeader);
  const pairingBroken = noncedCsp && nonces.nonced === 0;

  console.log(`\n${'='.repeat(74)}\n${path}`);
  console.log(`  scripts=${nonces.scripts} nonced=${nonces.nonced} cspNamesNonce=${noncedCsp}` +
    (pairingBroken ? '   *** PAIRING BROKEN — every script blocked ***' : ''));

  console.log(`  CSP violations: ${csp.length || '0 (none)'}`);
  for (const v of csp) console.log(`    [${v.directive}] ${v.blocked.slice(0, 92)}`);

  console.log(`  uncaught page errors: ${pageErrors.length || '0 (none)'}`);
  for (const e of [...new Set(pageErrors)]) console.log(`    ${e.slice(0, 150)}`);

  const tags = ['gtm.js', 'gtag/js', 'fbevents.js', 'analytics.google.com/g/collect', 'clarity.ms'];
  const missing = tags.filter((t) => !sent.some((u) => u.includes(t)));
  console.log(`  analytics tags attempted: ${tags.length - missing.length}/${tags.length}` +
    (missing.length ? `  missing: ${missing.join(', ')}` : ''));

  if (csp.length || pageErrors.length || pairingBroken) failures++;
  await ctx.close();
}

await browser.close();

console.log(`\n${'='.repeat(74)}`);
if (failures) {
  console.error(`FAIL — ${failures} of ${PATHS.length} page(s) reported a violation or page error.`);
  process.exit(1);
}
console.log(`PASS — ${PATHS.length} page(s) clean.`);
