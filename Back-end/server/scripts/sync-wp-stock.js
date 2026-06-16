/**
 * Sync product stock from WooCommerce → MongoDB.
 *
 *   node scripts/sync-wp-stock.js            # dry run (default — no writes)
 *   node scripts/sync-wp-stock.js --apply    # write the new stock values
 *
 * WooCommerce stores availability in `stock_status`; `stock_quantity` is null for
 * products with stock management off (~99% here). Earlier imports used
 * `stock_quantity ?? 0`, which made every untracked product read as out of stock.
 * This recomputes numeric `stock` from WP availability. Idempotent.
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import axios from 'axios';
import Product from '../models/Product.js';

const APPLY = process.argv.includes('--apply');
const MONGO_URI     = process.env.MONGO_URI            || process.env.MONGODB_URI;
const WP_SITE_URL   = process.env.WORDPRESS_SITE_URL   || process.env.WOOCOMMERCE_BASE_URL;
const WP_API_KEY    = process.env.WORDPRESS_API_KEY    || process.env.WOOCOMMERCE_CONSUMER_KEY;
const WP_API_SECRET = process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET;
const WC_VERSION    = process.env.WORDPRESS_API_VERSION || 'wc/v3';

const STOCK_AVAILABLE = 999; // untracked-but-available sentinel
const stockFromWc = (wc) =>
  (wc.manage_stock && wc.stock_quantity != null)
    ? wc.stock_quantity
    : (wc.stock_status === 'outofstock' ? 0 : STOCK_AVAILABLE);

const wc = axios.create({
  baseURL: `${WP_SITE_URL.replace(/\/$/, '')}/wp-json`,
  auth: { username: WP_API_KEY, password: WP_API_SECRET },
  timeout: 60000,
});

async function fetchAll() {
  const out = [];
  for (let page = 1; ; page++) {
    const { data } = await wc.get(`/${WC_VERSION}/products`, {
      params: { per_page: 100, page, status: 'publish', _fields: 'id,name,stock_status,stock_quantity,manage_stock' },
    });
    out.push(...data);
    if (data.length < 100) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`=== Sync WP stock ${APPLY ? '(APPLY — writing)' : '(dry run — no writes)'} ===\n`);

  const products = await fetchAll();
  console.log(`Fetched ${products.length} WP products.\n`);

  const byStatus = {}, changes = [];
  let updated = 0, notFound = 0, unchanged = 0;

  for (const p of products) {
    byStatus[p.stock_status] = (byStatus[p.stock_status] || 0) + 1;
    const newStock = stockFromWc(p);
    const doc = await Product.findOne(
      { $or: [{ externalId: String(p.id) }, { wpId: p.id }] },
      { stock: 1, name: 1 }
    );
    if (!doc) { notFound++; continue; }
    if ((doc.stock ?? 0) === newStock) { unchanged++; continue; }

    if (changes.length < 12) changes.push({ id: p.id, name: (doc.name || '').slice(0, 38), from: doc.stock ?? 0, to: newStock, status: p.stock_status });
    if (APPLY) await Product.updateOne({ _id: doc._id }, { $set: { stock: newStock } });
    updated++;
  }

  console.log('WP stock_status breakdown:', JSON.stringify(byStatus));
  console.log(`\n${APPLY ? 'Updated' : 'Would update'}: ${updated}  |  unchanged: ${unchanged}  |  not found in Mongo: ${notFound}`);
  console.log('\nSample changes (from → to):');
  for (const c of changes) console.log(`  wp#${c.id} [${c.status}] ${c.from} → ${c.to}   ${c.name}`);

  await mongoose.connection.close();
}

run().catch(err => { console.error('✗', err.message); mongoose.connection.close(); process.exit(1); });
