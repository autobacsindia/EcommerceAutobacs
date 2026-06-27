/**
 * Yoast SEO → Mongo import (PRODUCTS).
 *
 * Pulls products from WooCommerce (same source/auth/matching as the price sync)
 * and copies their Yoast SEO fields into each product's `seo` sub-document:
 *
 *     _yoast_wpseo_title                 → seo.metaTitle
 *     _yoast_wpseo_metadesc              → seo.metaDescription
 *     _yoast_wpseo_focuskw               → seo.focusKeyword   (internal note)
 *     _yoast_wpseo_canonical             → seo.canonical
 *     _yoast_wpseo_opengraph-image       → seo.ogImage
 *     _yoast_wpseo_meta-robots-noindex   → seo.noindex        ('1' = noindex)
 *
 * Nothing else on the product is touched. Yoast values pass through the same
 * normalizeSeo() the live API uses (trim, strip tags, clamp lengths, reject
 * unsafe URLs) so imported data obeys the schema exactly.
 *
 * Two guards make the import faithful and non-destructive:
 *   1. TEMPLATE SKIP — Yoast titles/descriptions are often global templates like
 *      "%%title%% %%sep%% %%sitename%%", NOT real per-product overrides. Any value
 *      containing "%%" is skipped so we only import literal, human-written copy.
 *   2. FILL-ONLY (default) — a field is written only when Mongo's corresponding
 *      seo field is currently empty, so a re-run never clobbers overrides an admin
 *      typed in the SeoPanel after the first import. Pass --overwrite to force
 *      Yoast to win on every field.
 *
 * Matching: existing product by { wpId | externalId | slug } (same as the sync).
 * Products in WooCommerce but not in Mongo are skipped and reported.
 *
 * Idempotent. Dry-run by default. Only writes rows whose seo actually changes.
 *
 * Usage (run where WooCommerce + Mongo creds exist — i.e. prod env):
 *   railway run node --import=dotenv/config scripts/import-seo-from-woocommerce.js              # dry run
 *   railway run node --import=dotenv/config scripts/import-seo-from-woocommerce.js --apply       # write
 *   railway run node --import=dotenv/config scripts/import-seo-from-woocommerce.js --apply --overwrite
 *
 * After --apply: flush Redis route:* / public:* (npm run flush-cache) so the new
 * metadata is served. (npm run reindex-products not needed — seo isn't indexed.)
 *
 * Requires MONGODB_URI (or MONGO_URI) + WordPress/WooCommerce API config.
 */

import axios from 'axios';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import { normalizeSeo } from '../utils/seo.js';

const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');

function getWcConfig() {
  const base = (process.env.WORDPRESS_SITE_URL || process.env.WOOCOMMERCE_BASE_URL || '').replace(/\/$/, '');
  const key = process.env.WORDPRESS_API_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET;
  const version = process.env.WORDPRESS_API_VERSION || 'wc/v3';
  if (!base || !key || !secret) {
    throw new Error('WooCommerce misconfigured: set WORDPRESS_SITE_URL, WORDPRESS_API_KEY, WORDPRESS_API_SECRET');
  }
  return { base, key, secret, version };
}

const slugify = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A value is a dynamic template (not a literal override) if it contains a
// Yoast placeholder ("%%var%%") or an AIOSEO smart tag ("#post_excerpt",
// "#post_content", "#separator_sa", …). Both expand at render time, so storing
// them verbatim would leak raw tags into the meta — skip them.
const SMART_TAG = /%%|#[a-z][a-z0-9_]+/i;
const literal = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && !SMART_TAG.test(s) ? s : '';
};

/** Build a flat { key: value } map from WooCommerce meta_data. */
function metaMap(wc) {
  const map = {};
  for (const m of wc.meta_data || []) {
    if (m && typeof m.key === 'string') map[m.key] = m.value;
  }
  return map;
}

/**
 * Extract a normalized seo override object from a WC product's meta. Supports
 * BOTH plugins (Yoast and All in One SEO) since which one a store uses isn't
 * known up front; for each field we take the first plugin that has a literal
 * value. Only the postmeta-exposed fields are reachable via WC REST — AIOSEO's
 * core title lives in a private table and is intentionally not handled here.
 */
function extractSeoMeta(wc) {
  const meta = metaMap(wc);
  const raw = {
    // AIOSEO does not mirror the core title to postmeta; Yoast does.
    metaTitle: literal(meta['_yoast_wpseo_title']),
    // AIOSEO writes the meta description to _aioseo_description when overridden.
    metaDescription: literal(meta['_yoast_wpseo_metadesc']) || literal(meta['_aioseo_description']),
    focusKeyword: typeof meta['_yoast_wpseo_focuskw'] === 'string' ? meta['_yoast_wpseo_focuskw'] : '',
    canonical:
      (typeof meta['_yoast_wpseo_canonical'] === 'string' && meta['_yoast_wpseo_canonical']) ||
      (typeof meta['_aioseo_canonical_url'] === 'string' && meta['_aioseo_canonical_url']) || '',
    ogImage: typeof meta['_yoast_wpseo_opengraph-image'] === 'string' ? meta['_yoast_wpseo_opengraph-image'] : '',
    // Yoast stores '1' for noindex; anything else (incl. '0', '2', '') = index.
    noindex: String(meta['_yoast_wpseo_meta-robots-noindex']) === '1',
  };
  // Reuse the live normalizer so imported data is identical to admin-entered data.
  return normalizeSeo(raw);
}

/**
 * Merge a normalized Yoast seo object onto the existing product seo.
 * FILL-ONLY by default (only empty Mongo fields get written); --overwrite lets
 * Yoast win on every field it has a value for. Returns { next, changed }.
 */
function mergeSeo(existing = {}, incoming = {}) {
  const next = { ...existing };
  let changed = false;
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined || v === '' || v === false) continue; // nothing meaningful to import
    const cur = existing?.[k];
    const curEmpty = cur === undefined || cur === '' || cur === false;
    if (OVERWRITE || curEmpty) {
      if (cur !== v) { next[k] = v; changed = true; }
    }
  }
  return { next, changed };
}

async function wcGetAll(client, cfg, endpoint, params = {}) {
  const items = [];
  let page = 1;
  while (true) {
    const res = await client.get(`/${cfg.version}/${endpoint}`, { params: { per_page: 100, page, ...params } });
    items.push(...res.data);
    if (res.data.length < 100) break;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }
  return items;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('[ERROR] MONGODB_URI (or MONGO_URI) not set in environment');
    process.exit(1);
  }
  const cfg = getWcConfig();
  const client = axios.create({
    baseURL: `${cfg.base}/wp-json`,
    auth: { username: cfg.key, password: cfg.secret },
    timeout: 60000,
  });

  await mongoose.connect(uri);
  console.log(`[import-seo] connected. mode=${APPLY ? 'APPLY' : 'DRY-RUN'} merge=${OVERWRITE ? 'OVERWRITE' : 'FILL-ONLY'} source=${cfg.base}\n`);

  const wcProducts = await wcGetAll(client, cfg, 'products', { status: 'publish' });
  console.log(`[import-seo] fetched ${wcProducts.length} published WooCommerce products\n`);

  const stats = {
    fetched: wcProducts.length, withYoast: 0, changed: 0, unchanged: 0, notInDb: 0, failed: 0,
    fields: { metaTitle: 0, metaDescription: 0, focusKeyword: 0, canonical: 0, ogImage: 0, noindex: 0 },
  };
  const samples = [];
  const ops = [];

  for (const wc of wcProducts) {
    if (!wc.id || !wc.name) { stats.failed++; continue; }
    try {
      const incoming = extractSeoMeta(wc);
      if (Object.keys(incoming).length > 0) stats.withYoast++;

      const slug = wc.slug || slugify(wc.name);
      const doc = await Product.findOne(
        { $or: [{ wpId: wc.id }, { externalId: String(wc.id) }, { slug }] },
        { seo: 1, name: 1, sku: 1 }
      ).lean();

      if (!doc) { stats.notInDb++; continue; }

      const { next, changed } = mergeSeo(doc.seo || {}, incoming);
      if (!changed) { stats.unchanged++; continue; }

      // Tally which fields this row newly sets (vs the existing seo).
      for (const k of Object.keys(stats.fields)) {
        const before = doc.seo?.[k];
        const beforeEmpty = before === undefined || before === '' || before === false;
        if (next[k] !== before && (beforeEmpty || OVERWRITE) && next[k]) stats.fields[k]++;
      }

      stats.changed++;
      if (samples.length < 25) {
        samples.push(
          `  ${doc.sku || '(no sku)'}  ${doc.name?.slice(0, 45)}\n` +
          `      ${Object.entries(incoming).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' | ')}`
        );
      }
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { seo: next } } } });
    } catch (err) {
      console.error(`  ✗ [${wc.id}] "${wc.name}": ${err.message}`);
      stats.failed++;
    }
  }

  if (APPLY && ops.length) {
    const BATCH = 500;
    for (let i = 0; i < ops.length; i += BATCH) {
      await Product.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    }
  }

  console.log('--- Summary ---');
  console.log(`WC products fetched   : ${stats.fetched}`);
  console.log(`had literal overrides : ${stats.withYoast}`);
  console.log(`seo changed           : ${stats.changed}`);
  console.log(`already correct       : ${stats.unchanged}`);
  console.log(`in WC, not in Mongo   : ${stats.notInDb} (skipped)`);
  console.log(`failed                : ${stats.failed}`);
  console.log('  fields newly set across changed rows:');
  for (const [k, n] of Object.entries(stats.fields)) console.log(`    ${k.padEnd(16)}: ${n}`);

  if (stats.withYoast === 0) {
    console.log(
      '\n[INFO] No literal SEO overrides found on any product. This store\'s products\n' +
      'use dynamic SEO templates (Yoast %%vars%% / AIOSEO #smart_tags) that expand at\n' +
      'render time — there is nothing literal to migrate, and the app\'s computed\n' +
      'defaults already reproduce that output. (Note: AIOSEO\'s core title/description\n' +
      'also live in a private table not exposed via the WooCommerce REST API.)'
    );
  }

  if (samples.length) {
    console.log('\n--- Sample of imports (first 25) ---');
    console.log(samples.join('\n'));
  }

  console.log(
    APPLY
      ? `\n[APPLIED] ${ops.length} product(s) updated (seo only). Next: npm run flush-cache to serve the new metadata.`
      : `\n[DRY-RUN] ${ops.length} product(s) would be updated. Re-run with --apply to write.`
  );

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[import-seo] failed:', err);
  process.exit(1);
});
