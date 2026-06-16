/**
 * Build the brand registry from brand-config.js (governed by WordPress) and
 * resolve every product's brand. The config — not raw WP — is the source of
 * truth for names, types, aliases and exclusions, so the result is cleaner than
 * WP and stable across re-syncs.
 *
 *   node scripts/sync-wp-brands.js            # dry run (default — no writes)
 *   node scripts/sync-wp-brands.js --apply    # write changes
 *
 * Phase 1 — Brand collection := the config entries (each linked to its WP
 *   externalId where one exists). Brands not in the config are DEACTIVATED
 *   (isActive:false, not deleted — reversible).
 * Phase 2 — Each product's `brand`/`brandSlug` resolved via WP taxonomy →
 *   manufacturer aliases → make aliases → house fallback, with a coverage report.
 *
 * Idempotent.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import axios from 'axios';
import { load as loadHtml } from 'cheerio';
import Brand from '../models/Brand.js';
import Product from '../models/Product.js';
import { BRANDS, resolveBrand } from '../utils/brandResolution.js';

const APPLY = process.argv.includes('--apply');
const MONGO_URI     = process.env.MONGO_URI            || process.env.MONGODB_URI;
const WP_SITE_URL   = process.env.WORDPRESS_SITE_URL   || process.env.WOOCOMMERCE_BASE_URL;
const WP_API_KEY    = process.env.WORDPRESS_API_KEY    || process.env.WOOCOMMERCE_CONSUMER_KEY;
const WP_API_SECRET = process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET;
const WC_VERSION    = process.env.WORDPRESS_API_VERSION || 'wc/v3';

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (s) => (s ? loadHtml(`<root>${s}</root>`)('root').text().replace(/\s+/g, ' ').trim() : '');

const wc = axios.create({
  baseURL: `${WP_SITE_URL.replace(/\/$/, '')}/wp-json`,
  auth: { username: WP_API_KEY, password: WP_API_SECRET },
  timeout: 60000,
});
async function wcGetAll(endpoint, params = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const { data } = await wc.get(`/${WC_VERSION}/${endpoint}`, { params: { per_page: 100, page, ...params } });
    out.push(...data);
    if (data.length < 100) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`=== Brand registry + resolution ${APPLY ? '(APPLY — writing)' : '(dry run — no writes)'} ===\n`);

  // ── Phase 1: registry from config (WP supplies ids/logos where available) ───
  const wpBrands = await wcGetAll('products/brands', { _fields: 'id,name,slug,description' });
  const wpBySlug = new Map(wpBrands.map(b => [b.slug, b]));
  const existing = await Brand.find({}, { name: 1, slug: 1, externalId: 1, isActive: 1 }).lean();
  const byExt = new Map(existing.filter(b => b.externalId).map(b => [String(b.externalId), b]));
  const bySlug = new Map(existing.map(b => [b.slug, b]));
  const byNorm = new Map(existing.map(b => [norm(b.name), b]));

  let insert = 0, update = 0;
  const keptIds = new Set();  // existing docs claimed by a config entry — never deactivate these
  for (const b of BRANDS) {
    const wp = (b.wpSlugs || []).map(s => wpBySlug.get(s)).find(Boolean);
    const data = {
      name: b.name, slug: b.slug, type: b.type, aliases: b.aliases || [],
      externalId: wp ? String(wp.id) : undefined,
      description: wp ? clean(wp.description) : undefined,
      isActive: true,
      ...(b.logo ? { logo: { url: b.logo, public_id: '' } } : {}),
    };
    const match = (data.externalId && byExt.get(data.externalId)) || bySlug.get(b.slug) || byNorm.get(norm(b.name));
    if (match) { keptIds.add(String(match._id)); if (APPLY) await Brand.updateOne({ _id: match._id }, { $set: data }); update++; }
    else { if (APPLY) await Brand.create(data); insert++; }
  }
  const deactivate = existing.filter(b => !keptIds.has(String(b._id)) && b.isActive !== false);
  if (APPLY && deactivate.length) await Brand.updateMany({ _id: { $in: deactivate.map(b => b._id) } }, { $set: { isActive: false } });
  const makes = BRANDS.filter(b => b.type === 'make').length;
  const mfrs = BRANDS.filter(b => b.type === 'manufacturer').length;
  console.log(`Registry — ${BRANDS.length} brands (${makes} make, ${mfrs} manufacturer, ${BRANDS.length - makes - mfrs} house)`);
  console.log(`  ${APPLY ? '' : 'would '}insert ${insert}, update ${update}, deactivate ${deactivate.length} (kept, reversible)`);
  if (deactivate.length) console.log(`  deactivated: ${deactivate.map(b => b.name).join(', ')}`);

  // ── Phase 2: resolve product brands ────────────────────────────────────────
  const wpProducts = await wcGetAll('products', { status: 'publish', _fields: 'id,brands' });
  const wpSlugsById = new Map(wpProducts.map(p => [String(p.id), (p.brands || []).map(b => b.slug)]));

  const docs = await Product.find({}, { name: 1, brand: 1, brandSlug: 1, externalId: 1, wpId: 1 }).lean();
  const via = { wp: 0, manufacturer: 0, make: 0, house: 0, blank: 0 };
  let changed = 0; const blanks = [];
  for (const d of docs) {
    const key = d.externalId != null ? String(d.externalId) : (d.wpId != null ? String(d.wpId) : null);
    const wpSlugs = (key && wpSlugsById.get(key)) || [];
    const r = resolveBrand(d.name, wpSlugs);
    const name = r ? r.entry.name : '';
    const slug = r ? r.entry.slug : '';
    via[r ? r.via : 'blank']++;
    if (!r) { if (blanks.length < 20) blanks.push((d.name || '').slice(0, 52)); }
    if ((d.brand || '') !== name || (d.brandSlug || '') !== slug) {
      if (APPLY) await Product.updateOne({ _id: d._id }, { $set: { brand: name, brandSlug: slug } });
      changed++;
    }
  }
  const total = docs.length, covered = total - via.blank;
  console.log(`\nProducts — ${total} total, ${APPLY ? '' : 'would '}update ${changed}`);
  console.log(`  resolved via: WP taxonomy ${via.wp}, manufacturer ${via.manufacturer}, make ${via.make}, house ${via.house}`);
  console.log(`  COVERAGE: ${covered}/${total} (${(covered / total * 100).toFixed(1)}%)  |  still blank: ${via.blank}`);
  if (blanks.length) { console.log('  still-blank examples (add aliases to brand-config.js to cover):'); blanks.forEach(b => console.log(`    ${b}`)); }

  await mongoose.connection.close();
}

run().catch(err => { console.error('✗', err.message); mongoose.connection.close(); process.exit(1); });
