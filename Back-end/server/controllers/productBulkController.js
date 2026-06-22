/**
 * Bulk product import from CSV (admin).
 *   uploadCSV          — multer middleware (memory, .csv only)
 *   importProductsCSV  — POST /products/import/csv
 *
 * CSV columns (header row required; extra columns ignored):
 *   name, description, shortDescription, price, originalPrice,
 *   category, brand, stock, sku, tags
 * `category` accepts one or more category names/slugs separated by `|`.
 * `tags` accepts comma- or pipe-separated values.
 *
 * Returns a per-row report so the admin sees exactly what imported and what failed.
 */
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import Product from '../models/Product.js';
import categoryMappingService from '../services/categoryMappingService.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { STOCK_VALUES, STOCK_STATUS } from '../utils/stockStatus.js';

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// CSV-only multer (memory). Keep separate from the image upload instance.
export const uploadCSV = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ok = /csv$/i.test(file.originalname) || /text\/csv|application\/vnd.ms-excel|application\/csv/.test(file.mimetype);
    cb(ok ? null : new Error('Only .csv files are accepted'), ok);
  },
}).single('file');

// Generate a slug unique against the DB and the current batch.
const uniqueSlug = async (name, taken) => {
  const base = slugify(name) || `product-${Date.now()}`;
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (taken.has(candidate) || (await Product.exists({ slug: candidate }))) {
    candidate = `${base}-${n++}`;
  }
  taken.add(candidate);
  return candidate;
};

export const importProductsCSV = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded (field name: file).' });

  let rows;
  try {
    rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ success: false, message: `Could not parse CSV: ${e.message}` });
  }
  if (!rows.length) return res.status(400).json({ success: false, message: 'CSV has no data rows.' });

  if (!categoryMappingService.initialized) await categoryMappingService.initialize();

  const results = { total: rows.length, created: 0, failed: 0, errors: [] };
  const takenSlugs = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNo = i + 2; // +1 header, +1 to 1-index
    try {
      const name = (row.name || '').trim();
      const description = (row.description || '').trim();
      const price = Number(row.price);

      // Resolve categories (names/slugs separated by |)
      const catTokens = (row.category || '').split('|').map((s) => s.trim()).filter(Boolean);
      const categoryIds = [];
      const unresolved = [];
      for (const tok of catTokens) {
        const found = categoryMappingService.findCategory(tok);
        if (found) categoryIds.push(found._id);
        else unresolved.push(tok);
      }

      // Validate
      if (name.length < 3) throw new Error('name must be at least 3 characters');
      if (description.length < 10) throw new Error('description must be at least 10 characters');
      if (Number.isNaN(price) || price < 0) throw new Error('price must be a number >= 0');
      if (categoryIds.length === 0) throw new Error(`no valid category (unresolved: ${unresolved.join(', ') || 'none provided'})`);
      const stock = row.stock && STOCK_VALUES.includes(row.stock) ? row.stock : STOCK_STATUS.IN;

      const brand = (row.brand || '').trim();
      const tags = (row.tags || '').split(/[|,]/).map((t) => t.trim()).filter(Boolean);

      const product = new Product({
        name,
        description,
        shortDescription: (row.shortDescription || '').trim() || undefined,
        price,
        originalPrice: row.originalPrice ? Number(row.originalPrice) : undefined,
        categories: categoryIds,
        brand: brand || undefined,
        brandSlug: brand ? slugify(brand) : undefined,
        stock,
        sku: (row.sku || '').trim() || undefined,
        tags,
        slug: await uniqueSlug(name, takenSlugs),
        isActive: true,
      });
      await product.save();
      results.created++;
    } catch (err) {
      results.failed++;
      results.errors.push({ line: lineNo, name: row.name || '', reason: err.message });
    }
  }

  if (results.created > 0) invalidateCache('products');

  res.status(results.failed === 0 ? 201 : 207).json({
    success: results.failed === 0,
    message: `Imported ${results.created}/${results.total} products${results.failed ? `, ${results.failed} failed` : ''}.`,
    results,
  });
};
