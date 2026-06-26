/**
 * WordPress → MongoDB sync (service form).
 *
 * The single source of truth for the WP→Mongo sync logic, used by BOTH the CLI
 * (`scripts/migrate-from-wordpress.js`) and the scheduled cron (`cronService`).
 *
 * Contract:
 *   • assumes mongoose is ALREADY connected (server connects at boot; the CLI
 *     connects before calling) — it never opens/closes a connection or exits.
 *   • idempotent + non-destructive: upsert products/categories, migrate images;
 *     it never deletes or deactivates anything (orphan/dedup stay manual scripts).
 *   • returns structured stats; throws only on misconfiguration / fatal error.
 *
 * Cleaning, stock and brand rules are shared with the importer so a product gets
 * identical data however the sync is triggered.
 */
import axios from 'axios';
import https from 'https';
import http from 'http';
import mongoose from 'mongoose';
import { load as loadHtml } from 'cheerio';
import { v2 as cloudinary } from 'cloudinary';

import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import { resolveBrand } from '../utils/brandResolution.js';
import { STOCK_STATUS, statusFromQuantity } from '../utils/stockStatus.js';

function getConfig() {
  const cfg = {
    WC_BASE: (process.env.WORDPRESS_SITE_URL || process.env.WOOCOMMERCE_BASE_URL || '').replace(/\/$/, ''),
    WC_KEY: process.env.WORDPRESS_API_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY,
    WC_SECRET: process.env.WORDPRESS_API_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET,
    WC_VERSION: process.env.WORDPRESS_API_VERSION || 'wc/v3',
  };
  if (!cfg.WC_BASE || !cfg.WC_KEY || !cfg.WC_SECRET) {
    throw new Error('WordPress sync misconfigured: set WORDPRESS_SITE_URL, WORDPRESS_API_KEY, WORDPRESS_API_SECRET');
  }
  cfg.hasCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  return cfg;
}

/**
 * @param {object}  opts
 * @param {boolean} opts.dryRun      compute counts, write nothing
 * @param {boolean} opts.withImages  migrate images to Cloudinary (default true)
 * @param {object}  opts.logger      { log, warn, error } (default console)
 * @returns {Promise<{ok:boolean, stats:object, durationMs:number}>}
 */
export async function runWordPressSync({ dryRun = false, withImages = true, logger = console } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('runWordPressSync requires an active mongoose connection');
  }
  const cfg = getConfig();
  const log = (...a) => logger.log?.(...a);
  const warn = (...a) => logger.warn?.(...a);
  const errlog = (...a) => logger.error?.(...a);

  if (cfg.hasCloudinary) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  const wcClient = axios.create({
    baseURL: `${cfg.WC_BASE}/wp-json`,
    auth: { username: cfg.WC_KEY, password: cfg.WC_SECRET },
    timeout: 60000,
  });

  const stats = {
    products:   { fetched: 0, inserted: 0, updated: 0, failed: 0, unmappedCats: 0 },
    categories: { fetched: 0, inserted: 0, updated: 0, failed: 0, aliased: 0 },
    images:     { total: 0, migrated: 0, skipped: 0, failed: 0 },
  };

  // ── helpers ────────────────────────────────────────────────────────────────
  async function wcGetAll(endpoint, params = {}) {
    const items = [];
    let page = 1;
    while (true) {
      const res = await wcClient.get(`/${cfg.WC_VERSION}/${endpoint}`, { params: { per_page: 100, page, ...params } });
      items.push(...res.data);
      if (res.data.length < 100) break;
      page++;
      await new Promise(r => setTimeout(r, 200));
    }
    return items;
  }
  const slugify = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Map WooCommerce stock to our coarse status. When WC manages a numeric
  // quantity, derive low/in/out from it; otherwise honor WC's stock_status flag.
  const stockFromWc = (wc) => (wc.manage_stock && wc.stock_quantity != null)
    ? statusFromQuantity(wc.stock_quantity)
    : (wc.stock_status === 'outofstock' ? STOCK_STATUS.OUT : STOCK_STATUS.IN);
  function htmlToText(input, { keepNewlines = false } = {}) {
    if (input == null) return '';
    let s = String(input);
    if (keepNewlines) {
      s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, '\n').replace(/<\s*li[^>]*>/gi, '\n• ');
    }
    let text = loadHtml(`<root>${s}</root>`)('root').text().replace(/ /g, ' ').replace(/\r\n?/g, '\n');
    text = keepNewlines
      ? text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n')
      : text.replace(/\s+/g, ' ');
    return text.trim();
  }

  // ── Phase 1: Categories (first, so products can resolve category ids) ────────
  async function migrateCategories() {
    const wcCategories = await wcGetAll('products/categories');
    stats.categories.fetched = wcCategories.length;
    for (const wc of wcCategories) {
      try {
        const slug = wc.slug || slugify(wc.name);
        const existingDoc = await Category.findOne({ $or: [{ wpId: wc.id }, { slug }] });
        // WP duplicate-name categories: don't insert a clashing twin (unique name index).
        if (!existingDoc) {
          const sameName = await Category.findOne({ name: htmlToText(wc.name) });
          if (sameName) { stats.categories.aliased++; continue; }
        }
        const data = {
          wpId: wc.id, name: htmlToText(wc.name), slug,
          description: htmlToText(wc.description, { keepNewlines: true }),
          syncedFromWordPress: true, lastSyncedAt: new Date(), isActive: true,
          ...(wc.image?.src && !existingDoc?.image?.public_id && { image: { url: wc.image.src, public_id: '' } }),
        };
        if (dryRun) { existingDoc ? stats.categories.updated++ : stats.categories.inserted++; continue; }
        if (existingDoc) { await Category.findByIdAndUpdate(existingDoc._id, { $set: data }); stats.categories.updated++; }
        else { await new Category(data).save(); stats.categories.inserted++; }
      } catch (err) { errlog(`  ✗ Category [${wc.id}] "${wc.name}": ${err.message}`); stats.categories.failed++; }
    }
    log(`Categories — inserted ${stats.categories.inserted}, updated ${stats.categories.updated}, aliased ${stats.categories.aliased}, failed ${stats.categories.failed}`);
  }

  // ── Phase 2: Products (clean text, stock, brand, category links) ─────────────
  async function migrateProducts() {
    const wcProducts = await wcGetAll('products', { status: 'publish' });
    stats.products.fetched = wcProducts.length;

    const cats = await Category.find({}, { wpId: 1, slug: 1, name: 1 }).lean();
    const normName = (s) => htmlToText(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const catByWpId = new Map(cats.filter(c => c.wpId != null).map(c => [String(c.wpId), c._id]));
    const catBySlug = new Map(cats.filter(c => c.slug).map(c => [c.slug, c._id]));
    const catByName = new Map(cats.map(c => [normName(c.name), c._id]));
    const resolveCategories = (wcCats = []) => {
      const ids = new Set();
      for (const c of wcCats) {
        const id = catByWpId.get(String(c.id)) || catBySlug.get(c.slug) || catByName.get(normName(c.name));
        if (id) ids.add(String(id)); else stats.products.unmappedCats++;
      }
      return [...ids].map(s => new mongoose.Types.ObjectId(s));
    };

    for (const wc of wcProducts) {
      if (!wc.id || !wc.name) { stats.products.failed++; continue; }
      try {
        const slug = wc.slug || slugify(wc.name);
        const existingDoc = await Product.findOne({ $or: [{ wpId: wc.id }, { externalId: String(wc.id) }, { slug }] });
        const alreadyMigrated = existingDoc?.images?.length > 0 &&
          existingDoc.images.every(img => img.public_id && !img.public_id.startsWith('wp_'));
        const cleanName = htmlToText(wc.name);
        const r = resolveBrand(cleanName, (wc.brands || []).map(b => b.slug));
        const data = {
          wpId: wc.id, externalId: String(wc.id), wpSlug: wc.slug,
          syncedFromWordPress: true, lastSyncedAt: new Date(),
          name: cleanName, slug,
          description: htmlToText(wc.description, { keepNewlines: true }),
          shortDescription: htmlToText(wc.short_description, { keepNewlines: true }),
          // WooCommerce price semantics:
          //   regular_price = list price, sale_price = discounted price (blank if not on sale),
          //   price = the effective price WC currently charges (sale_price when on sale, else regular).
          // `price` is the customer-facing/charged price. `originalPrice` is the strikethrough
          // "was" price the discount badge reads — set ONLY when genuinely on sale, and null
          // otherwise so a product going off-sale clears its stale badge on the next sync.
          ...((() => {
            const effective = parseFloat(wc.price) || 0;
            const regular   = wc.regular_price ? parseFloat(wc.regular_price) : 0;
            const sale      = wc.sale_price ? parseFloat(wc.sale_price) : 0;
            const onSale    = sale > 0 && regular > sale;
            return {
              price: effective || regular || 0,
              originalPrice: onSale ? regular : null,
              salePrice: sale || undefined,
              regularPrice: regular || undefined,
            };
          })()),
          stock: stockFromWc(wc),
          sku: wc.sku || undefined,
          brand: r ? r.entry.name : '',
          brandSlug: r ? r.entry.slug : '',
          isActive: wc.status === 'publish',
          ...(!alreadyMigrated && {
            images: (wc.images || []).map((img, i) => ({ url: img.src, alt: htmlToText(img.alt) || cleanName, public_id: `wp_${img.id}`, isPrimary: i === 0 })),
          }),
          categories: resolveCategories(wc.categories),
          categoryIds: (wc.categories || []).map(c => c.id),
          tags: (wc.tags || []).map(t => htmlToText(t.name)).filter(Boolean),
          // WC product attributes → spec table (e.g. Size, Material, Fitment).
          // Mirrors the legacy importers; variation-only attributes are kept too
          // since their options describe the product. value joins multi-options.
          specifications: (wc.attributes || [])
            .map(a => ({
              key: htmlToText(a.name),
              value: htmlToText(Array.isArray(a.options) ? a.options.join(', ') : (a.option || a.options || '')),
            }))
            .filter(s => s.key && s.value),
        };
        if (dryRun) { existingDoc ? stats.products.updated++ : stats.products.inserted++; continue; }
        if (existingDoc) { await Product.findByIdAndUpdate(existingDoc._id, { $set: data }); stats.products.updated++; }
        else { await new Product(data).save(); stats.products.inserted++; }
      } catch (err) { errlog(`  ✗ Product [${wc.id}] "${wc.name}": ${err.message}`); stats.products.failed++; }
    }
    log(`Products — inserted ${stats.products.inserted}, updated ${stats.products.updated}, failed ${stats.products.failed}`);
  }

  // ── Phase 3: Images → Cloudinary ─────────────────────────────────────────────
  const downloadBuffer = (url) => new Promise((resolve, reject) => {
    if (!url?.startsWith('http')) return reject(new Error(`Not a valid URL: "${url}"`));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { timeout: 15000 }, (res) => {
      if ([301, 302].includes(res.statusCode) && res.headers.location) return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
  const uploadBuffer = (buffer, publicId) => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, overwrite: true, invalidate: true,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'],
        transformation: [{ fetch_format: 'auto', quality: 'auto' }] },
      (err, result) => err ? reject(err) : resolve({ url: result.secure_url, public_id: result.public_id })
    );
    stream.end(buffer);
  });

  async function migrateImages() {
    if (!cfg.hasCloudinary) { warn('Images — skipped (no Cloudinary config)'); return; }
    const products = await Product.find({
      'images.0': { $exists: true },
      $or: [{ 'images.public_id': { $exists: false } }, { 'images.public_id': '' }, { 'images.public_id': /^wp_/ }],
    }).select('_id name images');
    stats.images.total += products.length;
    for (const product of products) {
      let changed = false;
      for (let i = 0; i < product.images.length; i++) {
        const img = product.images[i];
        if (img.public_id && !img.public_id.startsWith('wp_') && img.url?.includes('res.cloudinary.com')) { stats.images.skipped++; continue; }
        if (!img.url?.startsWith('http')) { stats.images.skipped++; continue; }
        try {
          const buf = await downloadBuffer(img.url);
          const result = await uploadBuffer(buf, `autobacs/products/${product._id}/img-${i}`);
          product.images[i].url = result.url; product.images[i].public_id = result.public_id;
          changed = true; stats.images.migrated++;
        } catch (err) { errlog(`  ✗ Product image [${product._id}][${i}]: ${err.message}`); stats.images.failed++; }
      }
      if (changed) await product.save();
    }
    const categories = await Category.find({
      'image.url': { $exists: true, $ne: '' },
      $or: [{ 'image.public_id': { $exists: false } }, { 'image.public_id': '' }, { 'image.public_id': null }],
    }).select('_id name image');
    stats.images.total += categories.length;
    for (const cat of categories) {
      if (!cat.image?.url?.startsWith('http')) { stats.images.skipped++; continue; }
      try {
        const buf = await downloadBuffer(cat.image.url);
        const result = await uploadBuffer(buf, `autobacs/categories/${cat._id}`);
        cat.image.url = result.url; cat.image.public_id = result.public_id;
        await cat.save(); stats.images.migrated++;
      } catch (err) { errlog(`  ✗ Category image [${cat._id}]: ${err.message}`); stats.images.failed++; }
    }
    const brands = await Brand.find({
      $or: [{ logo: { $type: 'string', $ne: '' } }, { 'logo.url': { $exists: true, $ne: '' }, 'logo.public_id': { $in: ['', null] } }],
    }).select('_id name logo');
    stats.images.total += brands.length;
    for (const brand of brands) {
      const url = typeof brand.logo === 'string' ? brand.logo : brand.logo?.url;
      if (!url?.startsWith('http')) { stats.images.skipped++; continue; }
      if (url.includes('res.cloudinary.com') && brand.logo?.public_id) { stats.images.skipped++; continue; }
      try {
        const buf = await downloadBuffer(url);
        const result = await uploadBuffer(buf, `autobacs/brands/${brand._id}`);
        brand.logo = { url: result.url, public_id: result.public_id };
        await brand.save(); stats.images.migrated++;
      } catch (err) { errlog(`  ✗ Brand logo [${brand._id}]: ${err.message}`); stats.images.failed++; }
    }
    log(`Images — migrated ${stats.images.migrated}, skipped ${stats.images.skipped}, failed ${stats.images.failed}`);
  }

  // ── Phase 4: Verification ────────────────────────────────────────────────────
  async function verify() {
    const wpHost = cfg.WC_BASE.replace(/^https?:\/\//, '');
    const dirtyRe = { $regex: '<[^>]+>|&[a-z]+;|&#[0-9]+;', $options: 'i' };
    const v = {
      wpImages: await Product.countDocuments({ 'images.url': { $regex: wpHost.replace('.', '\\.'), $options: 'i' } }),
      wpPlaceholders: await Product.countDocuments({ 'images.public_id': { $regex: '^wp_' } }),
      dirtyNames: await Product.countDocuments({ name: dirtyRe }),
      dirtyCatNames: await Category.countDocuments({ name: dirtyRe }),
      noCategory: await Product.countDocuments({ isActive: true, $or: [{ categories: { $exists: false } }, { categories: { $size: 0 } }] }),
      totalProducts: await Product.countDocuments({}),
    };
    stats.verification = v;
    const ok = v.wpImages === 0 && v.wpPlaceholders === 0;
    log(`Verify — products ${v.totalProducts}, wpImages ${v.wpImages}, wp_ placeholders ${v.wpPlaceholders}, dirty names ${v.dirtyNames}, no-category ${v.noCategory} → ${ok ? 'PASS' : 'INCOMPLETE'}`);
    return ok;
  }

  // ── Orchestrate ──────────────────────────────────────────────────────────────
  const t0 = Date.now();
  log(`WP→Mongo sync ${dryRun ? '(DRY RUN)' : ''} — source ${cfg.WC_BASE}`);
  await migrateCategories();
  await migrateProducts();
  if (withImages && !dryRun) await migrateImages();
  const ok = dryRun ? true : await verify();
  const durationMs = Date.now() - t0;
  log(`WP→Mongo sync done in ${(durationMs / 1000).toFixed(1)}s`);
  return { ok, stats, durationMs };
}

export default runWordPressSync;
