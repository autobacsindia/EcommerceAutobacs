/**
 * WooCommerce product reviews → Mongo `Review` (ADR-005, residual WP migration).
 *
 * Contract mirrors the other WP importers:
 *   • assumes mongoose is ALREADY connected; never opens/closes a connection or exits.
 *   • idempotent + non-destructive: upsert keyed on `wpId`; never deletes.
 *   • returns structured stats; throws only on misconfiguration / fatal error.
 *
 * WooCommerce reviews are user-less from our model's POV (reviewer name + email only),
 * so they land with `guestName`/`guestEmail` and no `user`. `createdAt` is preserved
 * via a raw write (timestamps:true would otherwise stamp now). Product rating
 * aggregates are recomputed afterwards.
 */
import axios from 'axios';
import mongoose from 'mongoose';
import { load as loadHtml } from 'cheerio';

import Review from '../models/Review.js';
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
    throw new Error('WordPress review import misconfigured: set WORDPRESS_SITE_URL, WORDPRESS_API_KEY, WORDPRESS_API_SECRET');
  }
  return cfg;
}

function htmlToText(input) {
  if (input == null) return '';
  const text = loadHtml(`<root>${String(input)}</root>`)('root').text();
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * @param {object}  opts
 * @param {boolean} opts.dryRun  compute counts, write nothing (default true)
 * @param {object}  opts.logger  { log, warn, error } (default console)
 * @returns {Promise<{ok:boolean, stats:object, durationMs:number}>}
 */
export async function runReviewImport({ dryRun = true, logger = console } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('runReviewImport requires an active mongoose connection');
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

  const stats = { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, unmatchedProducts: 0 };
  const t0 = Date.now();
  log(`WP reviews → Mongo ${dryRun ? '(DRY RUN — no writes)' : ''} — source ${cfg.WC_BASE}`);

  let job = null;
  if (!dryRun) {
    try {
      job = await ImportJob.create({
        jobId: `wp-reviews-${Date.now()}`, source: 'wordpress-reviews',
        status: 'running', startedAt: new Date(),
      });
    } catch (e) { warn(`ImportJob create failed (continuing): ${e.message}`); }
  }

  try {
    const products = await Product.find({ wpId: { $exists: true } }, { _id: 1, wpId: 1 }).lean();
    const productByWpId = new Map(products.map(p => [p.wpId, p._id]));

    // Fetch all reviews (any status), paginated.
    const reviews = [];
    let page = 1;
    while (true) {
      const res = await wc.get('/products/reviews', { params: { per_page: 100, page, orderby: 'id', order: 'asc' } });
      reviews.push(...res.data);
      if (res.data.length < 100) break;
      page++;
      await new Promise(r => setTimeout(r, 200));
    }
    stats.fetched = reviews.length;
    log(`Fetched ${stats.fetched} WooCommerce reviews`);

    const touchedProducts = new Set();

    for (const rv of reviews) {
      try {
        const productId = productByWpId.get(rv.product_id);
        if (!productId) { stats.unmatchedProducts++; stats.skipped++; continue; }

        const rating = Math.min(5, Math.max(1, parseInt(rv.rating, 10) || 5));
        const created = new Date(rv.date_created_gmt ? `${rv.date_created_gmt}Z` : rv.date_created);
        const data = {
          wpId: rv.id,
          product: productId,
          guestName: htmlToText(rv.reviewer) || 'Anonymous',
          guestEmail: (rv.reviewer_email || '').toLowerCase().trim() || undefined,
          rating,
          comment: htmlToText(rv.review) || '(no comment)',
          isVerifiedPurchase: !!rv.verified,
          isApproved: rv.status === 'approved',
        };

        const doc = new Review(data);
        await doc.validate();

        if (dryRun) {
          const exists = await Review.exists({ wpId: rv.id });
          exists ? stats.updated++ : stats.created++;
          touchedProducts.add(String(productId));
          continue;
        }

        const plain = doc.toObject({ depopulate: true });
        const existing = await Review.collection.findOne({ wpId: rv.id }, { projection: { _id: 1, createdAt: 1 } });
        if (existing) {
          plain._id = existing._id;
          plain.createdAt = existing.createdAt || created;
          await Review.collection.replaceOne({ _id: existing._id }, plain);
          stats.updated++;
        } else {
          plain.createdAt = created;
          await Review.collection.insertOne(plain);
          stats.created++;
        }
        touchedProducts.add(String(productId));
      } catch (err) {
        errlog(`  ✗ Review [${rv.id}] product ${rv.product_id}: ${err.message}`);
        stats.failed++;
      }
    }

    // Recompute averageRating / totalReviews for affected products (approved only).
    if (!dryRun) {
      for (const pid of touchedProducts) {
        const approved = await Review.find({ product: pid, isApproved: true }, { rating: 1 }).lean();
        const total = approved.length;
        const avg = total ? approved.reduce((s, r) => s + r.rating, 0) / total : 0;
        await Product.findByIdAndUpdate(pid, { averageRating: parseFloat(avg.toFixed(1)), totalReviews: total });
      }
    }

    log(`Reviews — created ${stats.created}, updated ${stats.updated}, skipped ${stats.skipped} (unmatched products ${stats.unmatchedProducts}), failed ${stats.failed}`);
    if (job) {
      job.status = 'completed'; job.completedAt = new Date(); job.progress = 100;
      job.totalProducts = stats.fetched;
      job.importedProducts = stats.created + stats.updated;
      job.failedProducts = stats.failed; job.skippedProducts = stats.skipped;
      await job.save().catch(() => {});
    }
    const durationMs = Date.now() - t0;
    log(`WP review import done in ${(durationMs / 1000).toFixed(1)}s`);
    return { ok: stats.failed === 0, stats, durationMs };
  } catch (err) {
    if (job) { job.status = 'failed'; job.failedAt = new Date(); job.errorMessage = err.message; await job.save().catch(() => {}); }
    throw err;
  }
}

export default runReviewImport;
