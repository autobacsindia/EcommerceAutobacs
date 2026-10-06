/**
 * Admin "Export to Excel" — the whole working catalogue as a real .xlsx.
 *
 * Two sheets, linked by Product ID:
 *   - Products: exactly one row per product, so the row count IS the catalogue
 *     count. A product with options shows its price range and how many of its
 *     options are available.
 *   - Options:  one row per option (colour, size…), each with its own price and
 *     stock, because that is where price and stock live for those products.
 *
 * Why .xlsx and not CSV: Excel silently rewrites CSV values on open — an SKU like
 * `00123` loses its zeros, a long code turns into `1.2E+11`. A typed .xlsx cell
 * keeps text as text. Every text cell is written with `type: String`, so a name
 * that starts with "=" is stored as text and never evaluated as a formula.
 *
 * Prices are the price charged right now (effectivePrice, the same authority as
 * checkout), so an expired sale shows its reverted price even before the cron sweep
 * rewrites the stored fields.
 */

import writeExcelFile from 'write-excel-file/node';
import productRepository from '../repositories/productRepository.js';
import categoryRepository from '../repositories/categoryRepository.js';
import vehicleRepository from '../repositories/vehicleRepository.js';
import { effectivePrice } from '../utils/productPrice.js';
import { STOCK_LABELS, isPurchasable } from '../utils/stockStatus.js';

const PAGE_SIZE = 500;

const siteUrl = () => (process.env.FRONTEND_URL || 'https://autobacsindia.com').split(',')[0].trim().replace(/\/$/, '');

const text = (value) => ({ type: String, value: value == null ? '' : String(value) });
const money = (value) => (Number.isFinite(value) ? { type: Number, value, format: '#,##0.00' } : text(''));
const count = (value) => ({ type: Number, value });
const date = (value) => (value ? { type: Date, value: new Date(value), format: 'dd-mmm-yyyy' } : text(''));

/** Header text, column width (characters), and how to read the cell from a row. */
export const PRODUCT_COLUMNS = [
  { header: 'Product ID', width: 26, cell: (r) => text(r.id) },
  { header: 'Product name', width: 48, cell: (r) => text(r.name) },
  { header: 'SKU', width: 18, cell: (r) => text(r.sku) },
  { header: 'Category', width: 28, cell: (r) => text(r.categories) },
  { header: 'Brand', width: 18, cell: (r) => text(r.brand) },
  { header: 'Options', width: 9, cell: (r) => count(r.optionCount) },
  { header: 'Price now (₹)', width: 14, cell: (r) => money(r.price) },
  { header: 'Price up to (₹)', width: 14, cell: (r) => money(r.priceTo) },
  { header: 'MRP / was (₹)', width: 14, cell: (r) => money(r.mrp) },
  { header: 'Sale ends', width: 13, cell: (r) => date(r.saleEndsAt) },
  { header: 'Stock', width: 26, cell: (r) => text(r.stock) },
  { header: 'Status', width: 9, cell: (r) => text(r.status) },
  { header: 'Fits vehicles', width: 40, cell: (r) => text(r.vehicles) },
  { header: 'Product page', width: 50, cell: (r) => text(r.url) },
  { header: 'Image', width: 50, cell: (r) => text(r.image) },
  { header: 'Last updated', width: 13, cell: (r) => date(r.updatedAt) },
];

export const OPTION_COLUMNS = [
  { header: 'Product ID', width: 26, cell: (r) => text(r.id) },
  { header: 'Product name', width: 48, cell: (r) => text(r.name) },
  { header: 'Option', width: 30, cell: (r) => text(r.option) },
  { header: 'Option SKU', width: 18, cell: (r) => text(r.optionSku) },
  { header: 'Price now (₹)', width: 14, cell: (r) => money(r.price) },
  { header: 'MRP / was (₹)', width: 14, cell: (r) => money(r.mrp) },
  { header: 'Sale ends', width: 13, cell: (r) => date(r.saleEndsAt) },
  { header: 'Stock', width: 14, cell: (r) => text(r.stock) },
  { header: 'Product status', width: 14, cell: (r) => text(r.status) },
];

/** Price the buyer pays now, plus the slashed "was" price only while it is really higher. */
function pricing(source, now) {
  const price = effectivePrice(source, now);
  const saleLive = source.saleEndsAt ? new Date(source.saleEndsAt) > now : true;
  const mrp = typeof source.originalPrice === 'number' && source.originalPrice > price && saleLive
    ? source.originalPrice
    : null;
  return { price, mrp, saleEndsAt: mrp && source.saleEndsAt ? source.saleEndsAt : null };
}

const stockLabel = (s) => STOCK_LABELS[s] || s || '';

/** "2 of 3 options available" — the honest product-level stock for a product with options. */
function optionStockSummary(variants) {
  const available = variants.filter((v) => isPurchasable(v.stock)).length;
  return available === 0
    ? `Out of Stock (all ${variants.length} options)`
    : `${available} of ${variants.length} options available`;
}

/**
 * Resolve the ids a page refers to, fetching only the ones not seen yet — names
 * are batch-loaded once per page instead of one query per product.
 */
async function resolveNames(ids, cache, load) {
  const missing = [...new Set(ids.map(String))].filter((id) => !cache.has(id));
  if (missing.length) {
    for (const doc of await load(missing)) cache.set(String(doc._id), doc);
    for (const id of missing) if (!cache.has(id)) cache.set(id, null); // dangling ref
  }
}

/** Every product (one row each) and every option (one row each), oldest first. */
export async function buildExportData({ now = new Date() } = {}) {
  const products = [];
  const options = [];
  const categories = new Map();
  const vehicles = new Map();
  const base = siteUrl();
  let afterId = null;

  for (;;) {
    const page = await productRepository.findForExport({ afterId, limit: PAGE_SIZE });
    if (page.length === 0) break;
    afterId = page[page.length - 1]._id;

    await resolveNames(page.flatMap((p) => p.categories || []), categories,
      (ids) => categoryRepository.find({ _id: { $in: ids } }, 'name').lean());
    await resolveNames(page.flatMap((p) => p.compatibleVehicles || []), vehicles,
      (ids) => vehicleRepository.find({ _id: { $in: ids } }, 'make model').lean());

    for (const p of page) {
      const id = String(p._id);
      const status = p.isActive ? 'Live' : 'Hidden';
      const variants = p.variants || [];
      const row = {
        id,
        name: p.name,
        sku: p.sku || '',
        categories: (p.categories || []).map((c) => categories.get(String(c))?.name).filter(Boolean).join(', '),
        brand: p.brand || '',
        optionCount: variants.length,
        status,
        vehicles: (p.compatibleVehicles || [])
          .map((v) => vehicles.get(String(v)))
          .filter(Boolean)
          .map((v) => `${v.make} ${v.model}`)
          .join(', '),
        url: p.slug ? `${base}/products/${encodeURIComponent(p.slug)}` : '',
        image: p.images?.[0]?.url || '',
        updatedAt: p.updatedAt,
      };

      if (variants.length === 0) {
        products.push({ ...row, ...pricing(p, now), priceTo: null, stock: stockLabel(p.stock) });
        continue;
      }

      const priced = variants.map((v) => ({ v, ...pricing(v, now) }));
      for (const { v, price, mrp, saleEndsAt } of priced) {
        options.push({
          id, name: p.name, status,
          option: v.label || '', optionSku: v.sku || '',
          price, mrp, saleEndsAt, stock: stockLabel(v.stock),
        });
      }
      const prices = priced.map((x) => x.price).filter(Number.isFinite);
      const low = prices.length ? Math.min(...prices) : null;
      const high = prices.length ? Math.max(...prices) : null;
      products.push({
        ...row,
        // A range only when the options really differ; one price otherwise.
        price: low, priceTo: high !== low ? high : null,
        // MRP / sale end are per option — see the Options sheet.
        mrp: null, saleEndsAt: null,
        stock: optionStockSummary(variants),
      });
    }
    if (page.length < PAGE_SIZE) break;
  }
  return { products, options };
}

const sheet = (name, columns, rows) => ({
  sheet: name,
  data: [
    columns.map((c) => ({ type: String, value: c.header, fontWeight: 'bold' })),
    ...rows.map((r) => columns.map((c) => c.cell(r))),
  ],
  columns: columns.map((c) => ({ width: c.width })),
  stickyRowsCount: 1,
});

/** The finished workbook as a Buffer, plus counts for the audit log. */
export async function buildProductsWorkbook({ now = new Date() } = {}) {
  const { products, options } = await buildExportData({ now });
  const buffer = await writeExcelFile([
    sheet('Products', PRODUCT_COLUMNS, products),
    sheet('Options', OPTION_COLUMNS, options),
  ]).toBuffer();
  return { buffer, productCount: products.length, optionCount: options.length };
}
