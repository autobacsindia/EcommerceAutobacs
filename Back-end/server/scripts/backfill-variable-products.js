/**
 * Backfill embedded variants[] onto already-migrated WooCommerce VARIABLE products.
 *
 *   node scripts/backfill-variable-products.js --dry-run           # report only, no writes
 *   node scripts/backfill-variable-products.js --ip=147.93.23.15   # apply
 *   node scripts/backfill-variable-products.js --ip=1.2.3.4 --id=19330   # single product
 *
 * Why an --ip flag: post-cutover the apex (WORDPRESS_SITE_URL=autobacsindia.com)
 * resolves to the new Vercel site, so /wp-json 403s. The live WooCommerce origin
 * still runs on Hostinger; pass its IP (or set WORDPRESS_ORIGIN_IP) and the script
 * pins the TLS socket to it while keeping Host/SNI = the domain.
 *
 * What it does: fetches every published `type=variable` product from Woo, maps its
 * variations with the SAME logic as the live sync (utils/wcVariants.js), and updates
 * the matching Mongo product (by wpId) → productType='variable', variants[], and the
 * derived priceMin/priceMax + parent price/stock. Idempotent + non-destructive.
 *
 * TEST-ENV NOTE: run against the TEST Mongo (set MONGO_URI to the test cluster).
 * This writes ONLY to Mongo. It does NOT touch Elasticsearch or Redis — reindex +
 * cache flush are a separate, prod-time step (test shares prod ES/Redis).
 *
 * Requires MONGO_URI, WORDPRESS_API_KEY, WORDPRESS_API_SECRET, and the origin IP.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import axios from 'axios';
import https from 'https';
import Product from '../models/Product.js';
import { mapVariationsToVariants, aggregateFromVariants } from '../utils/wcVariants.js';

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

// Pin the TLS socket to the Hostinger origin IP; keep Host/SNI = the domain so
// WordPress serves the right vhost and the cert still validates by name.
const agent = new https.Agent({
  servername: HOST,
  lookup: (hostname, options, cb) =>
    options && options.all ? cb(null, [{ address: IP, family: 4 }]) : cb(null, IP, 4),
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
    if (res.data.length < 100) break; page++; await sleep(200);
  }
  return out;
}

(async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`=== Backfill variable products ${DRY ? '(DRY RUN — no writes)' : '(APPLY)'} ===`);
  console.log(`Mongo: ${mongoose.connection.host}  |  Woo origin: ${IP} (Host ${HOST})\n`);

  // 1. Which variable products to process.
  let variableProducts;
  if (ONLY_ID) {
    const res = await wc.get(`/products/${ONLY_ID}`);
    variableProducts = [res.data];
  } else {
    variableProducts = await wcGetAll('/products', { status: 'publish', type: 'variable' });
  }
  console.log(`Woo published variable products: ${variableProducts.length}\n`);

  const stats = { updated: 0, noMongoMatch: 0, noVariants: 0, totalVariants: 0, failed: 0 };
  const noMatch = [];

  for (const p of variableProducts.sort((a, b) => a.id - b.id)) {
    try {
      const doc = await Product.findOne({ wpId: p.id });
      if (!doc) { stats.noMongoMatch++; noMatch.push(p.id); continue; }

      const wcVariations = await wcGetAll(`/products/${p.id}/variations`);
      const variants = mapVariationsToVariants(wcVariations);
      if (!variants.length) { stats.noVariants++; console.log(`  · ${p.id} "${(p.name||'').replace(/<[^>]+>/g,'').slice(0,45)}" — no variations, skipped`); continue; }

      const agg = aggregateFromVariants(variants);
      stats.totalVariants += variants.length;
      console.log(`  ✓ ${p.id}  v=${String(variants.length).padStart(2)}  ₹${agg.priceMin}–₹${agg.priceMax}  ${(p.name||'').replace(/<[^>]+>/g,'').slice(0,50)}`);

      if (!DRY) {
        await Product.findByIdAndUpdate(doc._id, {
          $set: { productType: 'variable', variants, ...agg, lastSyncedAt: new Date() },
        });
      }
      stats.updated++;
      await sleep(150);
    } catch (err) {
      stats.failed++;
      console.error(`  ✗ ${p.id}: ${err.response?.status || ''} ${err.message}`);
    }
  }

  console.log(`\n${DRY ? 'Would update' : 'Updated'}: ${stats.updated} | total variants: ${stats.totalVariants} | no-variants: ${stats.noVariants} | no Mongo match: ${stats.noMongoMatch} | failed: ${stats.failed}`);
  if (noMatch.length) console.log(`No Mongo doc for wpIds: ${noMatch.join(', ')}`);
  await mongoose.connection.close();
  process.exit(stats.failed ? 1 : 0);
})().catch(err => { console.error('✗ Backfill failed:', err.message); mongoose.connection.close(); process.exit(1); });
