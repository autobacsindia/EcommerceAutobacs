/**
 * WooCommerce orders → Mongo `Order` (ADR-005, residual WP migration).
 *
 * These are HISTORICAL orders: flagged `source:'woocommerce'`, read-only, never
 * entering the live fulfilment queues. They exist so the sales/marketing dashboard
 * (services/dashboardAnalyticsService.js — aggregates revenue/top-products/customers
 * straight from `Order`) has real history.
 *
 * Contract mirrors the other WP importers:
 *   • assumes mongoose is ALREADY connected; never opens/closes a connection or exits.
 *   • idempotent + non-destructive: upsert keyed on `wpId`; never deletes.
 *   • returns structured stats; throws only on misconfiguration / fatal error.
 *
 * Why raw collection writes: Mongoose `timestamps:true` would stamp `createdAt = now`
 * on save, collapsing every historical order onto today's date and destroying the
 * dashboard's time-bucketed revenue. We validate via a Mongoose doc (casting + schema
 * checks) then insert the plain object so the real WooCommerce order date is preserved.
 */
import axios from 'axios';
import mongoose from 'mongoose';
import { load as loadHtml } from 'cheerio';

import Order from '../models/Order.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import ImportJob from '../models/ImportJob.js';

function getConfig() {
  const cfg = {
    WC_BASE: (process.env.WORDPRESS_SITE_URL || process.env.WOOCOMMERCE_BASE_URL || '').replace(/\/$/, ''),
    WC_KEY: process.env.WORDPRESS_API_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY,
    WC_SECRET: process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET,
    WC_VERSION: process.env.WORDPRESS_API_VERSION || 'wc/v3',
  };
  if (!cfg.WC_BASE || !cfg.WC_KEY || !cfg.WC_SECRET) {
    throw new Error('WordPress order import misconfigured: set WORDPRESS_SITE_URL, WORDPRESS_API_KEY, WORDPRESS_API_SECRET');
  }
  return cfg;
}

const decode = (s) => {
  if (s == null) return '';
  const str = String(s);
  if (!str.includes('&')) return str.trim();
  return loadHtml(`<root>${str}</root>`)('root').text().trim();
};
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

// WooCommerce status → { status (fulfilment), paymentStatus }. Order.status was
// refactored to fulfilment-only (see scripts/migrate-order-status-phase2.js); payment
// state now lives in paymentStatus. Original WC status is preserved in legacyStatus.
const STATUS_MAP = {
  pending:          { status: 'awaiting_payment', paymentStatus: 'pending'   },
  'checkout-draft': { status: 'awaiting_payment', paymentStatus: 'pending'   },
  'on-hold':        { status: 'awaiting_payment', paymentStatus: 'pending'   },
  processing:       { status: 'processing',       paymentStatus: 'paid'      },
  completed:        { status: 'delivered',        paymentStatus: 'paid'      },
  cancelled:        { status: 'cancelled',        paymentStatus: 'cancelled' },
  trash:            { status: 'cancelled',        paymentStatus: 'cancelled' },
  failed:           { status: 'cancelled',        paymentStatus: 'failed'    },
  refunded:         { status: 'cancelled',        paymentStatus: 'refunded'  },
};
const DEFAULT_MAP = { status: 'awaiting_payment', paymentStatus: 'pending' };

// Build a schema-valid shippingAddress. Historical WC orders sometimes miss fields;
// required fields fall back so the order still imports (address isn't used in analytics).
function buildAddress(order) {
  const s = order.shipping || {};
  const b = order.billing || {};
  const pick = (k) => decode(s[k]) || decode(b[k]);
  const fullName = [pick('first_name'), pick('last_name')].filter(Boolean).join(' ') || 'WooCommerce Customer';
  return {
    fullName,
    phone: decode(b.phone) || 'N/A',
    addressLine1: pick('address_1') || 'N/A',
    addressLine2: pick('address_2') || undefined,
    city: pick('city') || 'N/A',
    state: pick('state') || 'N/A',
    postalCode: pick('postcode') || '000000',
    country: pick('country') || 'India',
  };
}

/**
 * @param {object}  opts
 * @param {boolean} opts.dryRun  compute counts, write nothing (default true)
 * @param {object}  opts.logger  { log, warn, error } (default console)
 * @returns {Promise<{ok:boolean, stats:object, durationMs:number}>}
 */
export async function runOrderImport({ dryRun = true, logger = console } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('runOrderImport requires an active mongoose connection');
  }
  const cfg = getConfig();
  const log = (...a) => logger.log?.(...a);
  const warn = (...a) => logger.warn?.(...a);
  const errlog = (...a) => logger.error?.(...a);

  const wc = axios.create({
    baseURL: `${cfg.WC_BASE}/wp-json/${cfg.WC_VERSION}`,
    auth: { username: cfg.WC_KEY, password: cfg.WC_SECRET },
    timeout: 60000,
  });

  const stats = { fetched: 0, created: 0, updated: 0, guest: 0, linked: 0, skipped: 0, failed: 0, unmatchedProducts: 0 };
  const t0 = Date.now();
  log(`WP orders → Mongo ${dryRun ? '(DRY RUN — no writes)' : ''} — source ${cfg.WC_BASE}`);

  let job = null;
  if (!dryRun) {
    try {
      job = await ImportJob.create({
        jobId: `wp-orders-${Date.now()}`, source: 'wordpress-orders',
        status: 'running', startedAt: new Date(),
      });
    } catch (e) { warn(`ImportJob create failed (continuing): ${e.message}`); }
  }

  try {
    // ── Lookups: customer wpId/email → User._id, product wpId → Product._id ──────
    const users = await User.find({ wpId: { $exists: true } }, { _id: 1, wpId: 1, email: 1 }).lean();
    const userByWpId = new Map(users.map(u => [u.wpId, u._id]));
    const userByEmail = new Map(users.filter(u => u.email).map(u => [u.email.toLowerCase(), u._id]));
    const products = await Product.find({ wpId: { $exists: true } }, { _id: 1, wpId: 1 }).lean();
    const productByWpId = new Map(products.map(p => [p.wpId, p._id]));

    // ── Fetch all orders (any status) ────────────────────────────────────────────
    const orders = [];
    let page = 1;
    while (true) {
      const res = await wc.get('/orders', { params: { per_page: 100, page, status: 'any', orderby: 'id', order: 'asc' } });
      orders.push(...res.data);
      if (res.data.length < 100) break;
      page++;
      await new Promise(r => setTimeout(r, 200));
    }
    stats.fetched = orders.length;
    log(`Fetched ${stats.fetched} WooCommerce orders`);

    for (const o of orders) {
      try {
        // Resolve user: customer_id → email → guest.
        let userId = (o.customer_id && userByWpId.get(o.customer_id)) || null;
        const billingEmail = (o.billing?.email || '').toLowerCase().trim();
        if (!userId && billingEmail) userId = userByEmail.get(billingEmail) || null;

        // Line items → order items (snapshot name/price; link product when known).
        const items = (o.line_items || []).map(li => {
          const productId = productByWpId.get(li.product_id);
          if (!productId) stats.unmatchedProducts++;
          const qty = li.quantity || 1;
          return {
            ...(productId && { product: productId }),
            quantity: qty,
            price: num(li.price) || (num(li.total) / qty) || 0,
            name: decode(li.name),
            image: li.image?.src || undefined,
          };
        });

        const subtotalFromItems = (o.line_items || []).reduce((s, li) => s + num(li.subtotal), 0);
        const tax = num(o.total_tax);
        const shippingCost = num(o.shipping_total);
        const discount = num(o.discount_total);
        const totalAmount = num(o.total);
        const subtotal = subtotalFromItems || Math.max(0, totalAmount - tax - shippingCost + discount);

        const created = new Date(o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created);
        const modified = new Date(o.date_modified_gmt ? `${o.date_modified_gmt}Z` : (o.date_modified || o.date_created));
        const mapped = STATUS_MAP[o.status] || DEFAULT_MAP;
        const status = mapped.status;
        const payNote = o.payment_method_title || o.payment_method || 'unknown';

        const data = {
          wpId: o.id,
          source: 'woocommerce',
          legacyStatus: o.status,
          status,
          paymentStatus: mapped.paymentStatus,
          ...(userId && { user: userId }),
          ...(!userId && billingEmail && { guestEmail: billingEmail }),
          items,
          shippingAddress: buildAddress(o),
          subtotal,
          shippingCost,
          tax,
          discount,
          totalAmount,
          statusHistory: [{ status, timestamp: created }],
          notes: `Imported from WooCommerce (order #${o.number || o.id}) | payment: ${payNote}`,
          createdAt: created,
          updatedAt: modified,
        };

        if (!userId) stats.guest++; else stats.linked++;

        // Validate via a Mongoose doc (casting + schema rules). Done in dry-run too so it
        // is a real preview that surfaces schema problems before any write.
        const doc = new Order(data);
        await doc.validate();

        if (dryRun) {
          const exists = await Order.exists({ wpId: o.id });
          exists ? stats.updated++ : stats.created++;
          continue;
        }

        // Write the plain object directly so timestamps:true can't clobber the
        // historical createdAt.
        const plain = doc.toObject({ depopulate: true });

        const existing = await Order.collection.findOne({ wpId: o.id }, { projection: { _id: 1, createdAt: 1 } });
        if (existing) {
          plain._id = existing._id;
          plain.createdAt = existing.createdAt || created; // never move an order's original date
          await Order.collection.replaceOne({ _id: existing._id }, plain);
          stats.updated++;
        } else {
          await Order.collection.insertOne(plain);
          stats.created++;
        }
      } catch (err) {
        errlog(`  ✗ Order [${o.id}] #${o.number}: ${err.message}`);
        stats.failed++;
      }
    }

    log(`Orders — created ${stats.created}, updated ${stats.updated}, linked-to-user ${stats.linked}, guest ${stats.guest}, unmatched-products ${stats.unmatchedProducts}, failed ${stats.failed}`);
    if (job) {
      job.status = 'completed'; job.completedAt = new Date(); job.progress = 100;
      job.totalProducts = stats.fetched;
      job.importedProducts = stats.created + stats.updated;
      job.failedProducts = stats.failed; job.skippedProducts = stats.skipped;
      await job.save().catch(() => {});
    }
    const durationMs = Date.now() - t0;
    log(`WP order import done in ${(durationMs / 1000).toFixed(1)}s`);
    return { ok: stats.failed === 0, stats, durationMs };
  } catch (err) {
    if (job) { job.status = 'failed'; job.failedAt = new Date(); job.errorMessage = err.message; await job.save().catch(() => {}); }
    throw err;
  }
}

export default runOrderImport;
