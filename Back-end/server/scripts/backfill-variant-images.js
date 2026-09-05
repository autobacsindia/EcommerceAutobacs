/**
 * CLI: recover per-model photos from WooCommerce → this catalogue.
 *
 *   node --import=dotenv/config scripts/backfill-variant-images.js                # DRY RUN
 *   node --import=dotenv/config scripts/backfill-variant-images.js --product=<slug|id>
 *   node --import=dotenv/config scripts/backfill-variant-images.js --apply
 *   node --import=dotenv/config scripts/backfill-variant-images.js --rollback=<journal.json>
 *
 * Decisions live in services/variantImageBackfill.js (pure, unit-tested). This
 * file is I/O: Woo fetch, byte download, R2 put, Mongo write, journal.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *   • DRY RUN by default. --apply is required to write a single byte.
 *   • STRICTLY ADDITIVE. There is no delete call anywhere in this script. It
 *     appends gallery entries and sets variant pointers. Existing images, their
 *     order, and the primary are never touched — new entries go to the END, so
 *     the PDP hero image and every listing thumbnail are unchanged.
 *   • IDEMPOTENT by construction: object keys are derived from the source URL,
 *     so a re-run (including after a crash mid-way) reuses its own work.
 *   • JOURNALLED. Every --apply writes ./backfill-variant-images.<ts>.json and
 *     prints the path. --rollback=<file> reverses exactly that run.
 *   • TRIPWIRE. Aborts if the download failure rate exceeds --max-fail-ratio
 *     (default 0.25). Mass failure means the wrong host or dead credentials, and
 *     the right response is to stop, not to half-migrate 142 products.
 *
 * ── The source host ─────────────────────────────────────────────────────────
 * WooCommerce is NOT at autobacsindia.com any more — that name serves the new
 * storefront on Vercel. It is still on its original Hostinger IP, which answers
 * for the old vhost when the Host header says so. WOO_ORIGIN_IP overrides it.
 * Fetching by domain returns the new site's 404 page, which would look like
 * "the image is gone" rather than "you asked the wrong server".
 *
 * ── Derivatives ─────────────────────────────────────────────────────────────
 * Pre-generated width/format variants are produced by a BullMQ worker on
 * Railway's PRIVATE network, unreachable from a local run. That is not a
 * blocker: the image Worker falls back to serving the original object when a
 * derivative is missing (infra/cloudflare/image-worker/src/worker.js), so
 * backfilled photos display correctly immediately and merely cost more bytes
 * until derivatives are generated. Enqueue them afterwards from Railway.
 *
 * ── After --apply ───────────────────────────────────────────────────────────
 *   1. npm run flush-cache          (in an env whose REDIS_URL is the CACHE one)
 *   2. spot-check a few PDPs in a browser
 * Atlas Search needs nothing: it indexes `products` via change streams, and
 * `variants` is not in the index mapping anyway.
 */
import mongoose from 'mongoose';
import https from 'https';
import fs from 'fs';
import path from 'path';
import Product from '../models/Product.js';
import '../models/Category.js';
import '../models/Vehicle.js';
import { putObject } from '../services/storage/r2Provider.js';
import { toObjectUrl } from '../services/storage/keys.js';
import { r2Config } from '../config/storage.js';
import { decodeEntities } from '../utils/wcVariants.js';
import {
  planProductBackfill,
  composeProductUpdate,
  summarise,
  SKIP,
  PUBLIC_CACHE_CONTROL,
} from '../services/variantImageBackfill.js';

const TAG = '[backfill-variant-images]';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => {
  const hit = argv.find((a) => a.startsWith(`${f}=`));
  return hit ? hit.slice(f.length + 1) : d;
};

const APPLY = has('--apply');
const ONLY = val('--product');
const ROLLBACK = val('--rollback');
const MATCH_BY_LABEL = has('--match-by-label');
const MAX_FAIL_RATIO = Number(val('--max-fail-ratio', '0.25'));

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const WOO_HOST = (process.env.WORDPRESS_SITE_URL || 'https://autobacsindia.com')
  .replace(/^https?:\/\//, '').replace(/\/+$/, '');
const WOO_IP = process.env.WOO_ORIGIN_IP || '147.93.23.15';
const WOO_KEY = process.env.WORDPRESS_API_KEY;
const WOO_SECRET = process.env.WORDPRESS_API_SECRET;

const die = (msg) => { console.error(`${TAG} ✗ ${msg}`); process.exit(1); };

/**
 * Connect with autoIndex OFF.
 *
 * It defaults to TRUE, so merely connecting would build every index declared
 * across the model graph against whatever cluster this points at — which for a
 * local run is PRODUCTION. Non-negotiable in any script that imports models.
 */
const connect = async () => {
  if (!MONGO_URI) die('Missing MONGO_URI / MONGODB_URI');
  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log(`${TAG} connected to ${MONGO_URI.split('@').pop().split('/')[0]}`);
};

/**
 * GET from the legacy origin by IP, with TLS pinned to the ORIGINAL hostname.
 *
 * Three things have to line up, and getting any one wrong looks like "the image
 * is gone" rather than "you asked the wrong server":
 *   • connect to the IP        — the domain now resolves to Vercel
 *   • Host header              — so Apache serves the WordPress vhost
 *   • TLS `servername` (SNI)   — otherwise the handshake validates the cert
 *                                against the IP and fails ERR_TLS_CERT_ALTNAME_INVALID
 *
 * Certificate verification stays ON. Disabling it (curl's -k) would also
 * silence a genuine MITM on a plaintext-credentialed request, and it is not
 * needed: with SNI set, the cert validates normally.
 *
 * Node core `https` rather than fetch+undici Agent deliberately — `undici` is
 * only a TRANSITIVE dependency here, so importing it directly would leave this
 * script one hoisting change away from failing to start.
 */
const getFromOrigin = (url, { headers = {}, timeout = 60_000 } = {}) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request({
      host: WOO_IP,
      servername: target.hostname,      // SNI + what the cert is validated against
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: { Host: target.hostname, ...headers },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeout}ms`)));
    req.on('error', reject);
    req.end();
  });

/** WooCommerce REST via the origin IP, authenticating with the v3 key pair. */
const woo = async (endpoint) => {
  const auth = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64');
  const { status, body } = await getFromOrigin(
    `https://${WOO_HOST}/wp-json/wc/v3/${endpoint}`,
    { headers: { Authorization: `Basic ${auth}` }, timeout: 45_000 },
  );
  if (status !== 200) throw new Error(`Woo ${endpoint} → HTTP ${status}`);
  return JSON.parse(body.toString('utf8'));
};

/** Fetch image bytes from the legacy host. */
const download = async (sourceUrl) => {
  const { status, body } = await getFromOrigin(sourceUrl);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  // A zero-length body is a failure no status code reports. Writing it would put
  // a broken object in the bucket AND a pointer to it on a live product.
  if (body.length === 0) throw new Error('empty body');
  return body;
};

// ── Rollback ────────────────────────────────────────────────────────────────

const rollback = async (file) => {
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`${TAG} rolling back ${journal.entries.length} product change(s) from ${file}`);
  await connect();

  let reverted = 0;
  for (const entry of journal.entries) {
    // Restore the EXACT pre-run document state that was captured before writing.
    // Reversing by "remove what we added" would also undo any admin edit made in
    // between; restoring the snapshot is wrong in a different way, so this is
    // deliberately narrow: it only rewrites the two fields this script touched.
    await Product.updateOne(
      { _id: entry.productId },
      { $set: { images: entry.before.images, variants: entry.before.variants } },
    );
    reverted++;
  }
  console.log(`${TAG} reverted ${reverted} product(s).`);
  console.log(
    `${TAG} NOTE: uploaded objects are intentionally left in R2 — they are unreferenced\n` +
    `      and harmless, and deleting them would break a re-run's ability to reuse them.\n` +
    `      Keys are listed in the journal if you want them removed manually.`
  );
  await mongoose.disconnect();
};

// ── Main ────────────────────────────────────────────────────────────────────

const main = async () => {
  if (ROLLBACK) return rollback(ROLLBACK);
  if (!WOO_KEY || !WOO_SECRET) die('Missing WORDPRESS_API_KEY / WORDPRESS_API_SECRET');
  if (APPLY && !r2Config().publicBaseUrl) die('R2_PUBLIC_BASE_URL is not set — uploads would be unaddressable');

  console.log(`${TAG} ${APPLY ? '*** APPLY ***' : 'DRY RUN (pass --apply to write)'}`);
  await connect();

  const filter = { productType: 'variable', 'variants.0': { $exists: true } };
  if (ONLY) {
    Object.assign(filter, mongoose.isValidObjectId(ONLY) ? { _id: ONLY } : { slug: ONLY });
  }
  const products = await Product.find(filter, '_id name slug images variants wpId').lean();
  console.log(`${TAG} ${products.length} variable product(s) in scope`);

  /*
    ── Variations are resolved GLOBALLY, not per product ─────────────────────

    The obvious shape is "for each of our products, GET its variations by parent
    id". That depends on `wpId` being present and correct on our row, and it is
    absent on rows imported before it was captured — for those the request would
    be `products//variations`, a 404 the planner would then read as "this model
    has no Woo image", silently skipping real work.

    Enumerating Woo's own variable products and indexing every variation by its
    own id removes that dependency: matching is `variants[].wpVariationId` →
    `variation.id`, the same stable key reconcileVariantIds already uses, and a
    product whose wpId we lost still matches. Cost is one pass over ~150 Woo
    products regardless of how many of ours are in scope.
  */
  const wooProducts = [];
  for (let page = 1; ; page++) {
    const batch = await woo(`products?per_page=100&type=variable&page=${page}`);
    wooProducts.push(...batch);
    if (batch.length < 100) break;
  }
  console.log(`${TAG} ${wooProducts.length} variable product(s) in WooCommerce`);

  const variationById = new Map();
  const variationsByParent = new Map();
  for (const wp of wooProducts) {
    const variations = await woo(`products/${wp.id}/variations?per_page=100`).catch((err) => {
      console.error(`${TAG} ! could not read variations of Woo #${wp.id}: ${err.message}`);
      return [];
    });
    for (const v of variations) variationById.set(String(v.id), v);
    variationsByParent.set(String(wp.id), variations);
  }
  console.log(`${TAG} ${variationById.size} Woo variation(s) indexed`);

  /*
    ── Product-level pairing, only needed for --match-by-label ────────────────

    Matching a severed model by label needs the CANDIDATE set to be exactly one
    Woo product's variations; searching all 506 would pair "Black" with whatever
    Woo product happened to use that word first. `wpId` would be the honest key,
    but it is absent on the rows that need this most, so names are the only link
    left. Normalised name equality, and only when unambiguous on both sides —
    the same discipline as the label matcher itself.
  */
  const norm = (v) => String(v ?? '')
    .replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
  const wooByName = new Map();
  const wooNameCounts = new Map();
  for (const wp of wooProducts) {
    const key = norm(wp.name);
    wooNameCounts.set(key, (wooNameCounts.get(key) || 0) + 1);
    wooByName.set(key, wp);
  }
  /** productId → the Woo product its labels were matched against (for the report). */
  const labelSourceProduct = new Map();

  // ── Plan ──────────────────────────────────────────────────────────────────
  const plans = products.map((product) => {
    const byId = product.variants
      .map((v) => (v.wpVariationId != null ? variationById.get(String(v.wpVariationId)) : null))
      .filter(Boolean);

    if (!MATCH_BY_LABEL) return planProductBackfill(product, byId);

    const key = norm(product.name);
    const counterpart = wooNameCounts.get(key) === 1 ? wooByName.get(key) : null;
    if (counterpart) labelSourceProduct.set(String(product._id), counterpart);
    const candidates = counterpart ? (variationsByParent.get(String(counterpart.id)) || []) : [];

    // Union: id matches stay authoritative, label matching only sees the rest.
    const seen = new Set(byId.map((v) => String(v.id)));
    return planProductBackfill(
      product,
      [...byId, ...candidates.filter((v) => !seen.has(String(v.id)))],
      { allowLabelMatch: true },
    );
  });

  const totals = summarise(plans);
  console.log(`${TAG} ── PLAN ─────────────────────────────────────────────`);
  console.log(`  products in scope     : ${totals.products}`);
  console.log(`  products with work    : ${totals.productsWithWork}`);
  console.log(`  images to upload      : ${totals.uploads}`);
  console.log(`  assets reused         : ${totals.reused}`);
  console.log(`  model pointers to set : ${totals.pointers}`);
  console.log('  skipped:');
  for (const [reason, n] of Object.entries(totals.skipped)) console.log(`      ${String(n).padStart(4)}  ${reason}`);

  // Unmatched models are listed individually, not just counted: each one is a
  // model that will KEEP showing its parent's photo, and whether that is fine
  // (a model created in our admin, never in Woo) or a problem (a wpVariationId
  // that drifted) is a judgement only a human looking at the names can make.
  const unmatched = plans.flatMap((p) =>
    p.skipped.filter((s) => s.reason === SKIP.UNMATCHED).map((s) => ({ slug: p.slug, ...s }))
  );
  const labelMatchedCount = plans.reduce((n, p) => n + p.labelMatched.length, 0);
  if (labelMatchedCount) {
    console.log(`\n${TAG} ── ${labelMatchedCount} model(s) matched by LABEL — VERIFY BEFORE --apply ──`);
    console.log('  These lost their wpVariationId to an admin save, so they were paired on');
    console.log('  the label text alone. Both sides are shown so the pairing can be checked.\n');
    for (const plan of plans.filter((p) => p.labelMatched.length)) {
      const woo = labelSourceProduct.get(plan.productId);
      console.log(`  OURS : ${plan.name}`);
      console.log(`         ${plan.slug}`);
      console.log(`  WOO  : ${woo ? decodeEntities(woo.name) : '(unresolved)'}${woo ? `   [id ${woo.id}]` : ''}`);
      for (const m of plan.labelMatched) {
        console.log(`      "${m.ourLabel}"  →  "${m.wcLabel}"   [variation ${m.wcVariationId}]`);
        console.log(`           ${m.sourceUrl || '(no image)'}`);
      }
      console.log('');
    }
  }

  if (unmatched.length) {
    console.log(`\n  ── ${unmatched.length} model(s) with no Woo counterpart (will keep the product image) ──`);
    for (const u of unmatched) console.log(`      ${u.slug}  →  ${u.label}`);
  }

  for (const plan of plans.filter((p) => p.uploads.length)) {
    console.log(`\n  ${plan.name}  (${plan.slug})`);
    for (const u of plan.uploads) {
      console.log(`      ${u.reuseExisting ? 'reuse' : 'UPLOAD'}  ${u.variantIds.length} model(s)  ${u.sourceUrl.slice(-60)}`);
    }
  }

  if (!APPLY) {
    console.log(`\n${TAG} DRY RUN — nothing written. Re-run with --apply.`);
    return mongoose.disconnect();
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  const journal = { startedAt: new Date().toISOString(), entries: [] };
  const journalPath = path.resolve(`backfill-variant-images.${Date.now()}.json`);
  let attempted = 0; let failed = 0; let written = 0;

  for (const plan of plans) {
    if (!plan.uploads.length) continue;
    const product = products.find((p) => String(p._id) === plan.productId);
    const uploaded = new Map();
    const keys = [];

    for (const upload of plan.uploads) {
      if (upload.reuseExisting) {
        uploaded.set(upload.sourceUrl, { url: toObjectUrl(r2Config().publicBaseUrl, upload.key), public_id: upload.publicId });
        continue;
      }
      attempted++;
      try {
            const body = await download(upload.sourceUrl);
            const { url } = await putObject({
          body, key: upload.key, scope: 'public',
          contentType: upload.contentType, cacheControl: PUBLIC_CACHE_CONTROL,
        });
        uploaded.set(upload.sourceUrl, { url, public_id: upload.publicId });
        keys.push(upload.key);
      } catch (err) {
        failed++;
        console.error(`${TAG} ! ${plan.slug}: ${upload.sourceUrl.slice(-50)} — ${err.message}`);
      }
    }

    // Tripwire, checked as we go: mass failure means the wrong host or dead
    // credentials, and continuing would half-migrate the catalogue.
    if (attempted >= 20 && failed / attempted > MAX_FAIL_RATIO) {
      console.error(
        `\n${TAG} ✗ ABORTING — ${failed}/${attempted} downloads failed (> ${MAX_FAIL_RATIO}).\n` +
        `      Almost always the wrong origin (WOO_ORIGIN_IP=${WOO_IP}) or expired Woo keys.\n` +
        `      ${written} product(s) already written; roll back with --rollback=${journalPath}`
      );
      if (journal.entries.length) fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
      process.exitCode = 1;
      return mongoose.disconnect();
    }

    const update = composeProductUpdate(product, plan, uploaded);
    if (!update) continue;

    journal.entries.push({
      productId: plan.productId,
      slug: plan.slug,
      keys,
      before: { images: product.images, variants: product.variants },
    });

    await Product.updateOne(
      { _id: plan.productId },
      { $set: { images: update.images, variants: update.variants } },
    );
    written++;
    console.log(`${TAG} ✓ ${plan.slug} — +${update.appended} image(s), ${update.pointed} pointer(s)`);
  }

  if (journal.entries.length) {
    fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  }

  console.log(`\n${TAG} APPLIED — ${written} product(s) updated, ${failed}/${attempted} download(s) failed.`);
  console.log(`${TAG} Journal: ${journalPath}`);
  console.log(`${TAG} Rollback: node --import=dotenv/config scripts/backfill-variant-images.js --rollback=${journalPath}`);
  console.log(`${TAG} NEXT: npm run flush-cache, then spot-check a few PDPs.`);
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(`${TAG} ✗ ${err.stack || err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
