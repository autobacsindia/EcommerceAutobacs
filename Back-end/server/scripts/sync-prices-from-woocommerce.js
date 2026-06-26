/**
 * PRICE-ONLY sync from WooCommerce.
 *
 * Pulls products from WooCommerce (same source/auth/matching as the full cron sync)
 * but writes ONLY the four price fields:
 *     price, originalPrice, salePrice, regularPrice
 * Nothing else is touched — name, description, shortDescription, categories, stock,
 * specifications, tags, images, isActive, Key Features, Why Choose, reviews, fitment
 * are all left exactly as they are in Mongo. Use this when WooCommerce is the source
 * of truth for PRICE only and the rest is managed in-app.
 *
 * Price rules (identical to services/wordpressSyncService.js):
 *   regular = regular_price, sale = sale_price, effective = wc.price
 *   onSale  = sale > 0 && regular > sale
 *   price         = effective || regular || 0     (the charged price)
 *   originalPrice = onSale ? regular : null        (strikethrough "was" → drives the % OFF badge)
 *   salePrice     = sale  > 0 ? sale    : null
 *   regularPrice  = regular > 0 ? regular : null
 *
 * Matching: existing product by { wpId | externalId | slug } (same as the full sync).
 * Products present in WooCommerce but NOT in Mongo are SKIPPED (this script never
 * creates products — that would need full data). They're reported so you can decide.
 *
 * Idempotent. Dry-run by default. Only writes rows whose price fields actually change.
 *
 * Usage (run where WooCommerce + Mongo creds exist — i.e. prod env):
 *   railway run node --import=dotenv/config scripts/sync-prices-from-woocommerce.js           # dry run
 *   railway run node --import=dotenv/config scripts/sync-prices-from-woocommerce.js --apply   # write
 *
 * After --apply: `npm run reindex-products` then flush Redis route:* / public:* keys.
 *
 * Requires MONGODB_URI (or MONGO_URI) + WordPress/WooCommerce API config.
 */

import axios from 'axios';
import mongoose from 'mongoose';
import Product from '../models/Product.js';

const APPLY = process.argv.includes('--apply');

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
const approxEqual = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.01;
const same = (a, b) => (a == null && b == null) ? true : (a != null && b != null && approxEqual(a, b));

// The single price rule, shared in spirit with wordpressSyncService.
function computePrices(wc) {
  const effective = parseFloat(wc.price) || 0;
  const regular = wc.regular_price ? parseFloat(wc.regular_price) : 0;
  const sale = wc.sale_price ? parseFloat(wc.sale_price) : 0;
  const onSale = sale > 0 && regular > sale;
  return {
    price: effective || regular || 0,
    originalPrice: onSale ? regular : null,
    salePrice: sale > 0 ? sale : null,
    regularPrice: regular > 0 ? regular : null,
  };
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
  console.log(`[sync-prices] connected. mode=${APPLY ? 'APPLY' : 'DRY-RUN'} source=${cfg.base}\n`);

  const wcProducts = await wcGetAll(client, cfg, 'products', { status: 'publish' });
  console.log(`[sync-prices] fetched ${wcProducts.length} published WooCommerce products\n`);

  const stats = { fetched: wcProducts.length, changed: 0, unchanged: 0, notInDb: 0, failed: 0,
    // breakdown of WHAT changes (a row can count in more than one):
    priceMoved: 0, badgeAdded: 0, badgeRemoved: 0, cleanupOnly: 0 };
  const samples = [];
  const priceMoves = []; // every row whose selling price changes — money-sensitive, list them all
  const ops = [];

  for (const wc of wcProducts) {
    if (!wc.id || !wc.name) { stats.failed++; continue; }
    try {
      const slug = wc.slug || slugify(wc.name);
      const doc = await Product.findOne(
        { $or: [{ wpId: wc.id }, { externalId: String(wc.id) }, { slug }] },
        { price: 1, originalPrice: 1, salePrice: 1, regularPrice: 1, name: 1, sku: 1 }
      ).lean();

      if (!doc) { stats.notInDb++; continue; }

      const next = computePrices(wc);
      const unchanged =
        same(doc.price, next.price) &&
        same(doc.originalPrice ?? null, next.originalPrice) &&
        same(doc.salePrice ?? null, next.salePrice) &&
        same(doc.regularPrice ?? null, next.regularPrice);

      if (unchanged) { stats.unchanged++; continue; }

      stats.changed++;
      // Classify the change so the operator sees impact, not just a count.
      const priceMoved = !same(doc.price, next.price);
      const oldBadge = doc.originalPrice != null && doc.originalPrice > (doc.price ?? 0);
      const newBadge = next.originalPrice != null && next.originalPrice > next.price;
      if (priceMoved) { stats.priceMoved++; priceMoves.push(`  ${doc.sku || '(no sku)'}  ${doc.price} → ${next.price}   ${doc.name?.slice(0, 50)}`); }
      if (!oldBadge && newBadge) stats.badgeAdded++;
      if (oldBadge && !newBadge) stats.badgeRemoved++;
      if (!priceMoved && !(!oldBadge && newBadge) && !(oldBadge && !newBadge)) stats.cleanupOnly++;
      if (samples.length < 25) {
        samples.push(
          `  ${doc.sku || '(no sku)'}  ${doc.name?.slice(0, 40)}\n` +
          `      price ${doc.price} → ${next.price} | originalPrice ${doc.originalPrice ?? '∅'} → ${next.originalPrice ?? '∅'}`
        );
      }
      // ONLY the four price fields. Nothing else is in this $set.
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { price: next.price, originalPrice: next.originalPrice, salePrice: next.salePrice, regularPrice: next.regularPrice } },
        },
      });
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
  console.log(`WC products fetched : ${stats.fetched}`);
  console.log(`price changed       : ${stats.changed}`);
  console.log(`already correct     : ${stats.unchanged}`);
  console.log(`in WC, not in Mongo : ${stats.notInDb} (skipped — not created)`);
  console.log(`failed              : ${stats.failed}`);
  console.log('  breakdown of the changed rows:');
  console.log(`    selling price moves : ${stats.priceMoved}  (customer-facing price changes)`);
  console.log(`    badge added (sale)  : ${stats.badgeAdded}  (genuine WC sale → % OFF appears)`);
  console.log(`    badge removed       : ${stats.badgeRemoved} (WC not on sale → stale % OFF cleared)`);
  console.log(`    cleanup only        : ${stats.cleanupOnly} (junk originalPrice nulled, no visible change)`);

  if (priceMoves.length) {
    console.log('\n--- ALL selling-price moves (review these — customer-facing ₹) ---');
    console.log(priceMoves.join('\n'));
  }

  if (samples.length) {
    console.log('\n--- Sample of changes (first 25, all buckets) ---');
    console.log(samples.join('\n'));
  }

  console.log(
    APPLY
      ? `\n[APPLIED] ${ops.length} product(s) updated (price fields only). Next: npm run reindex-products + flush Redis route:* / public:*.`
      : `\n[DRY-RUN] ${ops.length} product(s) would be updated. Re-run with --apply to write.`
  );

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[sync-prices] failed:', err);
  process.exit(1);
});
