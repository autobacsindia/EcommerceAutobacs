/**
 * WooCommerce customers → Mongo `User` (ADR-005, residual WP migration).
 *
 * Contract (mirrors wordpressSyncService):
 *   • assumes mongoose is ALREADY connected; never opens/closes a connection or exits.
 *   • idempotent + non-destructive: upserts users keyed on `wpId`, falls back to email;
 *     NEVER deletes, never downgrades an existing native user's password/role.
 *   • returns structured stats; throws only on misconfiguration / fatal error.
 *
 * Passwords are NOT migrated — WordPress stores phpass hashes that can't become bcrypt.
 * Migrated users get `migratedFromWp:true` + `mustResetPassword:true` and no passwordHash;
 * first login routes them through the existing reset / magic-link flow.
 */
import axios from 'axios';
import mongoose from 'mongoose';
import { load as loadHtml } from 'cheerio';

import User from '../models/User.js';
import ImportJob from '../models/ImportJob.js';

function getConfig() {
  const cfg = {
    WC_BASE: (process.env.WORDPRESS_SITE_URL || process.env.WOOCOMMERCE_BASE_URL || '').replace(/\/$/, ''),
    WC_KEY: process.env.WORDPRESS_API_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY,
    WC_SECRET: process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET,
    WC_VERSION: process.env.WORDPRESS_API_VERSION || 'wc/v3',
  };
  if (!cfg.WC_BASE || !cfg.WC_KEY || !cfg.WC_SECRET) {
    throw new Error('WordPress customer import misconfigured: set WORDPRESS_SITE_URL, WORDPRESS_API_KEY, WORDPRESS_API_SECRET');
  }
  return cfg;
}

const decode = (s) => {
  if (s == null) return '';
  const str = String(s);
  if (!str.includes('&')) return str.trim();
  return loadHtml(`<root>${str}</root>`)('root').text().trim();
};
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

/**
 * Build a valid AddressSchema subdoc from a WC billing/shipping block, or null if it
 * can't satisfy the required fields (fullName, phone, addressLine1, city, state, postalCode).
 */
function toAddress(block, fallbackName, fallbackPhone) {
  if (!block) return null;
  const fullName = decode([block.first_name, block.last_name].filter(Boolean).join(' ')) || fallbackName;
  const phone = decode(block.phone) || fallbackPhone;
  const addressLine1 = decode(block.address_1);
  const city = decode(block.city);
  const state = decode(block.state);
  const postalCode = decode(block.postcode);
  if (!fullName || !phone || !addressLine1 || !city || !state || !postalCode) return null;
  return {
    fullName, phone, addressLine1,
    addressLine2: decode(block.address_2) || undefined,
    city, state, postalCode,
    country: decode(block.country) || 'India',
  };
}

const addrKey = (a) => [a.addressLine1, a.city, a.postalCode].map(s => s.toLowerCase()).join('|');

/**
 * @param {object}  opts
 * @param {boolean} opts.dryRun  compute counts, write nothing (default true — caller opts in to writes)
 * @param {object}  opts.logger  { log, warn, error } (default console)
 * @returns {Promise<{ok:boolean, stats:object, durationMs:number}>}
 */
export async function runCustomerImport({ dryRun = true, logger = console } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('runCustomerImport requires an active mongoose connection');
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

  const stats = { fetched: 0, created: 0, updated: 0, linked: 0, skipped: 0, failed: 0 };
  const t0 = Date.now();
  log(`WP customers → Mongo ${dryRun ? '(DRY RUN — no writes)' : ''} — source ${cfg.WC_BASE}`);

  // ── ImportJob tracking (best-effort; never aborts the import) ────────────────
  let job = null;
  if (!dryRun) {
    try {
      job = await ImportJob.create({
        jobId: `wp-customers-${Date.now()}`, source: 'wordpress-customers',
        status: 'running', startedAt: new Date(),
      });
    } catch (e) { warn(`ImportJob create failed (continuing): ${e.message}`); }
  }

  try {
    // ── Fetch all customers ────────────────────────────────────────────────────
    const customers = [];
    let page = 1;
    while (true) {
      const res = await wc.get('/customers', { params: { per_page: 100, page, role: 'all', orderby: 'id', order: 'asc' } });
      customers.push(...res.data);
      if (res.data.length < 100) break;
      page++;
      await new Promise(r => setTimeout(r, 200));
    }
    stats.fetched = customers.length;
    log(`Fetched ${stats.fetched} WooCommerce customers`);

    // ── Upsert ──────────────────────────────────────────────────────────────────
    for (const c of customers) {
      try {
        const email = (c.email || '').toLowerCase().trim();
        if (!isEmail(email)) { stats.skipped++; continue; }

        const name = decode([c.first_name, c.last_name].filter(Boolean).join(' ')) || decode(c.username) || email.split('@')[0];
        const phone = decode(c.billing?.phone) || decode(c.shipping?.phone) || undefined;

        // Dedupe billing + shipping into a unique address set.
        const addresses = [];
        const seen = new Set();
        for (const a of [toAddress(c.billing, name, phone), toAddress(c.shipping, name, phone)]) {
          if (a && !seen.has(addrKey(a))) { seen.add(addrKey(a)); addresses.push(a); }
        }
        if (addresses.length) addresses[0].isDefault = true;

        const existingByWpId = await User.findOne({ wpId: c.id });
        const existingByEmail = existingByWpId ? null : await User.findOne({ email });

        if (dryRun) {
          if (existingByWpId) stats.updated++;
          else if (existingByEmail) stats.linked++;
          else stats.created++;
          continue;
        }

        if (existingByWpId) {
          // Idempotent re-run: refresh profile, don't touch credentials.
          existingByWpId.name = name || existingByWpId.name;
          if (phone && !existingByWpId.phone) existingByWpId.phone = phone;
          if (addresses.length && !existingByWpId.addresses?.length) existingByWpId.addresses = addresses;
          await existingByWpId.save();
          stats.updated++;
        } else if (existingByEmail) {
          // Email collision with a NATIVE Mongo user: link only. Never downgrade their
          // password, role, or verification; only fill genuinely-missing profile data.
          existingByEmail.wpId = c.id;
          if (phone && !existingByEmail.phone) existingByEmail.phone = phone;
          if (addresses.length && !existingByEmail.addresses?.length) existingByEmail.addresses = addresses;
          await existingByEmail.save();
          stats.linked++;
        } else {
          // New migrated user: no password, forced reset on first login.
          await User.create({
            name, email, wpId: c.id,
            role: 'customer',
            migratedFromWp: true,
            mustResetPassword: true,
            isVerified: true, // WooCommerce accounts are email-confirmed
            verifiedAt: new Date(),
            phone,
            addresses,
          });
          stats.created++;
        }
      } catch (err) {
        errlog(`  ✗ Customer [${c.id}] ${c.email}: ${err.message}`);
        stats.failed++;
      }
    }

    log(`Customers — created ${stats.created}, updated ${stats.updated}, linked ${stats.linked}, skipped ${stats.skipped}, failed ${stats.failed}`);
    if (job) {
      job.status = 'completed'; job.completedAt = new Date(); job.progress = 100;
      job.totalProducts = stats.fetched;
      job.importedProducts = stats.created + stats.updated + stats.linked;
      job.failedProducts = stats.failed; job.skippedProducts = stats.skipped;
      await job.save().catch(() => {});
    }
    const durationMs = Date.now() - t0;
    log(`WP customer import done in ${(durationMs / 1000).toFixed(1)}s`);
    return { ok: stats.failed === 0, stats, durationMs };
  } catch (err) {
    if (job) { job.status = 'failed'; job.failedAt = new Date(); job.errorMessage = err.message; await job.save().catch(() => {}); }
    throw err;
  }
}

export default runCustomerImport;
