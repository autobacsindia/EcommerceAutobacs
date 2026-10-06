/**
 * Admin "Export to Excel" — the whole working catalogue as a real .xlsx.
 *
 * Why .xlsx and not CSV: Excel silently rewrites CSV values on open — an SKU like
 * `00123` loses its zeros, a long code turns into `1.2E+11`. A typed .xlsx cell
 * keeps text as text.
 *
 * Shape: one row per product, or one row per OPTION for a product with variants —
 * price and stock live on the variant, so a single product row would hide them.
 *
 * Prices are the price charged right now (effectivePrice, the same authority as
 * checkout), so an expired sale shows its reverted price even before the cron sweep
 * rewrites the stored fields.
 *
 * Every text cell is written with `type: String`, so a product name that starts
 * with "=" is stored as text and never evaluated as a formula when opened.
 */

import writeExcelFile from 'write-excel-file/node';
import productRepository from '../repositories/productRepository.js';
import categoryRepository from '../repositories/categoryRepository.js';
import vehicleRepository from '../repositories/vehicleRepository.js';
import { effectivePrice } from '../utils/productPrice.js';
import { STOCK_LABELS } from '../utils/stockStatus.js';

const PAGE_SIZE = 500;

const siteUrl = () => (process.env.FRONTEND_URL || 'https://autobacsindia.com').split(',')[0].trim().replace(/\/$/, '');

const text = (value) => ({ type: String, value: value == null ? '' : String(value) });
const money = (value) => (Number.isFinite(value) ? { type: Number, value, format: '#,##0.00' } : text(''));
const date = (value) => (value ? { type: Date, value: new Date(value), format: 'dd-mmm-yyyy' } : text(''));

/** Header text, column width (characters), and how to read the cell from a row. */
export const COLUMNS = [
  { header: 'Product name', width: 48, cell: (r) => text(r.name) },
  { header: 'Option', width: 22, cell: (r) => text(r.option) },
  { header: 'SKU', width: 18, cell: (r) => text(r.sku) },
  { header: 'Option SKU', width: 18, cell: (r) => text(r.optionSku) },
  { header: 'Category', width: 28, cell: (r) => text(r.categories) },
  { header: 'Brand', width: 18, cell: (r) => text(r.brand) },
  { header: 'Price now (₹)', width: 14, cell: (r) => money(r.price) },
  { header: 'MRP / was (₹)', width: 14, cell: (r) => money(r.mrp) },
  { header: 'Sale ends', width: 13, cell: (r) => date(r.saleEndsAt) },
  { header: 'Stock', width: 14, cell: (r) => text(r.stock) },
  { header: 'Status', width: 9, cell: (r) => text(r.status) },
  { header: 'Fits vehicles', width: 40, cell: (r) => text(r.vehicles) },
  { header: 'Product page', width: 50, cell: (r) => text(r.url) },
  { header: 'Image', width: 50, cell: (r) => text(r.image) },
  { header: 'Last updated', width: 13, cell: (r) => date(r.updatedAt) },
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

/** Every product (and option) as flat export rows, oldest first. */
export async function buildExportRows({ now = new Date() } = {}) {
  const rows = [];
  const categories = new Map();
  const vehicles = new Map();
  const base = siteUrl();
  let afterId = null;

  for (;;) {
    const products = await productRepository.findForExport({ afterId, limit: PAGE_SIZE });
    if (products.length === 0) break;
    afterId = products[products.length - 1]._id;

    await resolveNames(products.flatMap((p) => p.categories || []), categories,
      (ids) => categoryRepository.find({ _id: { $in: ids } }, 'name').lean());
    await resolveNames(products.flatMap((p) => p.compatibleVehicles || []), vehicles,
      (ids) => vehicleRepository.find({ _id: { $in: ids } }, 'make model').lean());

    for (const p of products) {
      const shared = {
        name: p.name,
        sku: p.sku || '',
        categories: (p.categories || []).map((id) => categories.get(String(id))?.name).filter(Boolean).join(', '),
        brand: p.brand || '',
        status: p.isActive ? 'Live' : 'Hidden',
        vehicles: (p.compatibleVehicles || [])
          .map((id) => vehicles.get(String(id)))
          .filter(Boolean)
          .map((v) => `${v.make} ${v.model}`)
          .join(', '),
        url: p.slug ? `${base}/products/${encodeURIComponent(p.slug)}` : '',
        image: p.images?.[0]?.url || '',
        updatedAt: p.updatedAt,
      };
      const variants = p.variants || [];
      if (variants.length === 0) {
        rows.push({ ...shared, option: '', optionSku: '', ...pricing(p, now), stock: STOCK_LABELS[p.stock] || p.stock || '' });
      } else {
        for (const v of variants) {
          rows.push({
            ...shared,
            option: v.label || '',
            optionSku: v.sku || '',
            ...pricing(v, now),
            stock: STOCK_LABELS[v.stock] || v.stock || '',
          });
        }
      }
    }
    if (products.length < PAGE_SIZE) break;
  }
  return rows;
}

/** The finished workbook as a Buffer, plus the row count for the audit log. */
export async function buildProductsWorkbook({ now = new Date() } = {}) {
  const rows = await buildExportRows({ now });
  const header = COLUMNS.map((c) => ({ type: String, value: c.header, fontWeight: 'bold' }));
  const data = [header, ...rows.map((r) => COLUMNS.map((c) => c.cell(r)))];
  const buffer = await writeExcelFile(data, {
    sheet: 'Products',
    columns: COLUMNS.map((c) => ({ width: c.width })),
    stickyRowsCount: 1,
  }).toBuffer();
  return { buffer, rowCount: rows.length };
}
