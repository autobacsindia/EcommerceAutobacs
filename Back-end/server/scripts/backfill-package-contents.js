/**
 * Backfill Product.packageContents from the WooCommerce "Package"/"Package Includes"
 * custom tab (yikes_woo_products_tabs) — as POINTERS, not a paragraph.
 *
 *   node scripts/backfill-package-contents.js --dry-run --ip=147.93.23.15   # report only
 *   node scripts/backfill-package-contents.js --ip=147.93.23.15             # apply
 *   node scripts/backfill-package-contents.js --ip=1.2.3.4 --id=10722       # single product
 *
 * Same origin-pinning as backfill-variable-products.js: the apex resolves to Vercel
 * now, so pass the Hostinger origin IP (or WORDPRESS_ORIGIN_IP). Writes ONLY Mongo —
 * no ES/Redis (packageContents isn't indexed/searched). Idempotent + non-destructive
 * (an empty tab clears the field, mirroring the sync).
 *
 * TEST-ENV NOTE: set MONGO_URI to the test cluster to run against test.
 * Requires MONGO_URI, WORDPRESS_API_KEY, WORDPRESS_API_SECRET, and the origin IP.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import axios from 'axios';
import https from 'https';
import Product from '../models/Product.js';
import { extractPackageContents } from '../utils/wcCustomTabs.js';

const arg = (k) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : null; };
const DRY = process.argv.includes('--dry-run');
const ONLY_ID = arg('id') ? Number(arg('id')) : null;
const IP = arg('ip') || process.env.WORDPRESS_ORIGIN_IP;
const HOST = (process.env.WORDPRESS_SITE_URL || 'https://autobacsindia.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const KEY = process.env.WORDPRESS_API_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY;
const SECRET = process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET;

if (!MONGO_URI || !KEY || !SECRET) { console.error('✗ Missing MONGO_URI / WORDPRESS_API_KEY / WORDPRESS_API_SECRET'); process.exit(1); }
if (!IP) { console.error('✗ Missing origin IP — pass --ip=<hostinger-ip> or set WORDPRESS_ORIGIN_IP'); process.exit(1); }

const agent = new https.Agent({
  servername: HOST,
  lookup: (h, o, cb) => (o && o.all ? cb(null, [{ address: IP, family: 4 }]) : cb(null, IP, 4)),
});
const wc = axios.create({
  baseURL: `https://${HOST}/wp-json/wc/v3`,
  auth: { username: KEY, password: SECRET },
  httpsAgent: agent, timeout: 60000,
  headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' },
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function wcGetAll(path, params = {}) {
  const out = []; let page = 1;
  while (true) {
    const res = await wc.get(path, { params: { per_page: 100, page, ...params } });
    out.push(...res.data);
    if (res.data.length < 100) break; page++; await sleep(150);
  }
  return out;
}

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`=== Backfill packageContents ${DRY ? '(DRY RUN — no writes)' : '(APPLY)'} ===`);
  console.log(`Mongo: ${mongoose.connection.host}  |  Woo origin: ${IP} (Host ${HOST})\n`);

  const products = ONLY_ID
    ? [(await wc.get(`/products/${ONLY_ID}`, { params: { _fields: 'id,name,meta_data' } })).data]
    : await wcGetAll('/products', { status: 'publish', _fields: 'id,name,meta_data' });
  console.log(`Woo published products scanned: ${products.length}\n`);

  const stats = { withContents: 0, updated: 0, cleared: 0, noMongoMatch: 0, totalPointers: 0, failed: 0 };
  const noMatch = [];

  for (const p of products.sort((a, b) => a.id - b.id)) {
    try {
      const pointers = extractPackageContents(p.meta_data);
      const doc = await Product.findOne({ wpId: p.id }, { _id: 1, packageContents: 1 });
      if (!doc) { if (pointers.length) { stats.noMongoMatch++; noMatch.push(p.id); } continue; }

      const had = Array.isArray(doc.packageContents) ? doc.packageContents.length : 0;
      if (pointers.length === 0 && had === 0) continue; // nothing to do

      if (pointers.length) {
        stats.withContents++; stats.totalPointers += pointers.length;
        console.log(`  ✓ ${p.id}  ${String(pointers.length).padStart(2)} pts  ${(p.name || '').replace(/<[^>]+>/g, '').slice(0, 42)}`);
        if (pointers[0]) console.log(`       e.g. • ${pointers[0].slice(0, 70)}`);
      } else {
        stats.cleared++;
        console.log(`  · ${p.id} cleared (${had}→0)  ${(p.name || '').replace(/<[^>]+>/g, '').slice(0, 40)}`);
      }

      if (!DRY) {
        await Product.findByIdAndUpdate(doc._id, { $set: { packageContents: pointers, lastSyncedAt: new Date() } });
        stats.updated++;
      }
      await sleep(80);
    } catch (err) {
      stats.failed++;
      console.error(`  ✗ ${p.id}: ${err.response?.status || ''} ${err.message}`);
    }
  }

  console.log(`\n${DRY ? 'Would update' : 'Updated'}: ${stats.updated} | with contents: ${stats.withContents} | cleared: ${stats.cleared} | total pointers: ${stats.totalPointers} | no Mongo match: ${stats.noMongoMatch} | failed: ${stats.failed}`);
  if (noMatch.length) console.log(`No Mongo doc for wpIds: ${noMatch.slice(0, 30).join(', ')}${noMatch.length > 30 ? '…' : ''}`);
  await mongoose.connection.close();
  process.exit(stats.failed ? 1 : 0);
})().catch(err => { console.error('✗ Backfill failed:', err.message); mongoose.connection.close(); process.exit(1); });
