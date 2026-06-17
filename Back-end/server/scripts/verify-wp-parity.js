/**
 * READ-ONLY parity check: WooCommerce/WordPress vs Mongo (ADR-005 cutover gate).
 *
 *   node scripts/verify-wp-parity.js
 *
 * Compares WP source counts (REST X-WP-Total) against migrated Mongo docs per entity.
 * Writes nothing, deletes nothing, decommissions nothing — purely a go/no-go report.
 * Requires MONGO_URI (or MONGODB_URI), WORDPRESS_SITE_URL/API_KEY/API_SECRET.
 */
import dotenv from 'dotenv'; dotenv.config();
import axios from 'axios';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import Review from '../models/Review.js';
import Article from '../models/Article.js';

const base = (process.env.WORDPRESS_SITE_URL || process.env.WOOCOMMERCE_BASE_URL || '').replace(/\/$/, '');
const auth = {
  username: process.env.WORDPRESS_API_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY,
  password: process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET,
};
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const wc = axios.create({ baseURL: `${base}/wp-json/wc/v3`, auth, timeout: 60000 });
const wp = axios.create({ baseURL: `${base}/wp-json/wp/v2`, timeout: 60000 });

// X-WP-Total from a 1-row request (cheap; the header carries the full count).
const wpTotal = async (client, path, params = {}) => {
  const res = await client.get(path, { params: { per_page: 1, ...params } });
  return parseInt(res.headers['x-wp-total'] || '0', 10);
};

(async () => {
  if (!MONGO_URI || !base) { console.error('✗ Missing MONGO_URI or WORDPRESS_SITE_URL'); process.exit(1); }
  await mongoose.connect(MONGO_URI);
  console.log(`Parity check — WP ${base} vs Mongo\n`);

  const rows = [];
  const check = async (label, wpCount, mongoCount, note = '') => {
    rows.push({ label, wp: wpCount, mongo: mongoCount, status: mongoCount >= wpCount ? 'OK' : 'GAP', note });
  };

  try {
    await check('Products (published)', await wpTotal(wc, '/products', { status: 'publish' }),
      await Product.countDocuments({ wpId: { $exists: true } }), 'Mongo may exceed WP (manual additions)');
    await check('Categories', await wpTotal(wc, '/products/categories'),
      await Category.countDocuments({ wpId: { $exists: true } }), 'WP has known dup-name cats');
    await check('Customers', await wpTotal(wc, '/customers', { role: 'all' }),
      await User.countDocuments({ wpId: { $exists: true } }));
    await check('Orders (any status)', await wpTotal(wc, '/orders', { status: 'any' }),
      await Order.countDocuments({ source: 'woocommerce' }));
    await check('Reviews', await wpTotal(wc, '/products/reviews'),
      await Review.countDocuments({ wpId: { $exists: true } }));
    await check('Blog posts (published)', await wpTotal(wp, '/posts', { status: 'publish' }),
      await Article.countDocuments({ wpId: { $exists: true }, type: 'blog' }));

    const pad = (s, n) => String(s).padEnd(n);
    console.log(`${pad('Entity', 26)} ${pad('WP', 7)} ${pad('Mongo', 7)} Status`);
    console.log('-'.repeat(60));
    for (const r of rows) {
      console.log(`${pad(r.label, 26)} ${pad(r.wp, 7)} ${pad(r.mongo, 7)} ${r.status === 'OK' ? '✓ OK' : '✗ GAP'}${r.note ? '  — ' + r.note : ''}`);
    }
    const gaps = rows.filter(r => r.status === 'GAP');
    console.log('\n' + (gaps.length === 0
      ? '✓ All entities at or above parity — safe to plan WordPress decommission.'
      : `✗ ${gaps.length} entity(ies) below parity — investigate before decommission.`));
  } catch (err) {
    console.error('✗ Parity check failed:', err.message);
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
})();
