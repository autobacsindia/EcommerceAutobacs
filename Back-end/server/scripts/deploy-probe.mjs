#!/usr/bin/env node
/**
 * deploy-probe — watch what customers see while a production deploy rolls out.
 *
 * READ-ONLY. Sends only GET requests, about one per second, rotating through a
 * fixed list of public URLs (backend health, public catalogue APIs direct and
 * through the storefront's /api/v1 proxy, and storefront HTML pages). It never
 * logs in, never POSTs, never reads env/secrets. Output is one JSON line per
 * request (timestamp, target, status, latency, error) so a deploy window can be
 * replayed afterwards with `--summary`.
 *
 * Usage:
 *   node scripts/deploy-probe.mjs --minutes 20 --out probe.jsonl
 *   node scripts/deploy-probe.mjs --summary probe.jsonl
 *
 * Rate: /health and /ready share one 30/min limiter bucket per client IP, so
 * each is probed every ~10s (12/min combined). Everything else is far below its
 * limiter (120–300 per window).
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const API = process.env.PROBE_API || 'https://api.autobacsindia.com';
const WEB = process.env.PROBE_WEB || 'https://www.autobacsindia.com';
const SLUG = process.env.PROBE_SLUG || 'byd-sealion-7-aerokit';

// A 12-slot rotation at 1 req/s → each target once every 12 seconds.
const TARGETS = [
  ['api:health', `${API}/health`],
  ['web:home', `${WEB}/`],
  ['api:products', `${API}/api/v1/products?limit=4`],
  ['web:product', `${WEB}/products/${SLUG}`],
  ['api:ready', `${API}/ready`],
  ['proxy:products', `${WEB}/api/v1/products?limit=4`],
  ['api:product', `${API}/api/v1/products/slug/${SLUG}`],
  ['web:cart', `${WEB}/cart`],
  ['proxy:categories', `${WEB}/api/v1/categories`],
  ['proxy:product', `${WEB}/api/v1/products/slug/${SLUG}`],
  // Rarely visited product pages: not prerendered, so the first visit after a
  // storefront release renders from scratch. Shows the "first click is slow" cost.
  ['web:pdp-cold1', `${WEB}/products/jeep-wrangler-metal-side-steps`],
  ['web:pdp-cold2', `${WEB}/products/wheel-spacers-for-jeep-wrangler-jk-2007-2018`],
];

const TIMEOUT_MS = 15000;
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};

/**
 * One GET on a FRESH connection (agent: false). Node's fetch() reuses pooled
 * keep-alive sockets; on a laptop those die silently (sleep, NAT, Wi-Fi) and
 * every request to that host then queues behind the dead socket for ~15s —
 * the first version of this probe "measured" outages the live site never had.
 * A fresh connection per request is also what a new visitor actually gets.
 */
function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, {
      agent: false,
      headers: { 'user-agent': 'autobacs-deploy-probe/2 (read-only)', 'cache-control': 'no-cache', connection: 'close' },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', reject);
  });
}

async function probeOnce(name, url) {
  const t0 = performance.now();
  const rec = { ts: new Date().toISOString(), target: name };
  try {
    const res = await get(url);
    const body = res.body;
    rec.status = res.status;
    rec.ms = Math.round(performance.now() - t0);
    rec.bytes = body.length;
    for (const h of ['x-railway-request-id', 'x-vercel-id', 'x-vercel-cache', 'x-cache', 'retry-after']) {
      const v = res.headers[h];
      if (v) rec[h] = v;
    }
    // App Router HTML: Vercel deployment id rides on every asset as ?dpl=…
    // (present only with Skew Protection on), and the Next build id as "b":"…".
    const dpl = body.match(/dpl=(dpl_[A-Za-z0-9]+)/);
    if (dpl) rec.build = dpl[1];
    const b = body.match(/\\"b\\":\\"([A-Za-z0-9_-]+)/);
    if (b) rec.nextBuild = b[1];
    if (name === 'api:health') {
      try {
        const j = JSON.parse(body);
        rec.uptime = Math.round(j.uptime);
        rec.health = j.status;
        rec.db = j.database;
        rec.redis = j.redis;
      } catch { /* non-JSON health body is itself a finding */ rec.note = body.slice(0, 120); }
    }
    if (res.status >= 400) rec.note = body.slice(0, 160).replace(/\s+/g, ' ');
  } catch (err) {
    rec.ms = Math.round(performance.now() - t0);
    rec.error = err.name === 'TimeoutError' ? 'timeout' : `${err.name}: ${err.code || err.message}`;
  }
  return rec;
}

async function run() {
  const minutes = Number(arg('--minutes', 20));
  const out = arg('--out', `probe-${Date.now()}.jsonl`);
  const stream = fs.createWriteStream(out, { flags: 'a' });
  const end = Date.now() + minutes * 60_000;
  let i = 0;
  console.log(`probe → ${out} for ${minutes} min`);
  while (Date.now() < end) {
    const tick = Date.now();
    const [name, url] = TARGETS[i++ % TARGETS.length];
    // Fire and don't await: a slow/hung request must not stretch the cadence.
    probeOnce(name, url).then((rec) => {
      stream.write(JSON.stringify(rec) + '\n');
      const bad = rec.error || rec.status >= 400 || rec.ms > 3000;
      if (bad) console.log(`${rec.ts} ${name} ${rec.status ?? rec.error} ${rec.ms}ms ${rec.note ?? ''}`);
    });
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - tick))));
  }
  await new Promise((r) => setTimeout(r, TIMEOUT_MS + 500));
  stream.end();
}

function summary(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  rows.sort((a, b) => a.ts.localeCompare(b.ts));
  const by = {};
  for (const r of rows) {
    const s = (by[r.target] ??= { n: 0, bad: 0, ms: [], firstBad: null, lastBad: null, codes: {} });
    s.n++;
    s.ms.push(r.ms);
    const key = r.error || String(r.status);
    s.codes[key] = (s.codes[key] || 0) + 1;
    if (r.error || r.status >= 500 || r.status === 429 || r.status === 404) {
      s.bad++;
      s.firstBad ??= r.ts;
      s.lastBad = r.ts;
    }
  }
  const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
  for (const [t, s] of Object.entries(by)) {
    console.log(`${t.padEnd(18)} n=${s.n} bad=${s.bad} p50=${pct(s.ms, 0.5)}ms p95=${pct(s.ms, 0.95)}ms max=${Math.max(...s.ms)}ms codes=${JSON.stringify(s.codes)}${s.firstBad ? ` bad ${s.firstBad}→${s.lastBad}` : ''}`);
  }
  // Deploy markers: backend uptime resets and storefront build-id changes.
  let lastUp = null; let lastBuild = null;
  for (const r of rows) {
    if (r.target === 'api:health' && r.uptime != null) {
      if (lastUp != null && r.uptime < lastUp) console.log(`${r.ts} backend instance changed (uptime ${lastUp}s → ${r.uptime}s)`);
      lastUp = r.uptime;
    }
    if (r.build && r.target.startsWith('web:')) {
      if (lastBuild && r.build !== lastBuild) console.log(`${r.ts} storefront build ${lastBuild} → ${r.build}`);
      lastBuild = r.build;
    }
  }
}

if (args[0] === '--summary') summary(args[1]);
else run();
