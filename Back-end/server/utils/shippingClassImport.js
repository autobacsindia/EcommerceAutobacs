/**
 * Load a REVIEWED size-class sheet onto products: the logic behind
 * scripts/import-shipping-classes.js, kept here so it can be tested without a
 * CLI or a real cluster.
 *
 * Sheet columns (header row, any order; extra columns ignored):
 *   Slug, Size class, Length cm, Breadth cm, Height cm, Weight kg, Source link, Estimated
 *
 *  - Size class: Small / Medium / Large / XL, or "Not sure…" / blank = leave the
 *    class alone. A class from the sheet is stored as `manual` (a person reviewed it).
 *  - Length/Breadth/Height/Weight: the BARE product as listed online → `listedSize`.
 *    All four or none; never mixed with the packed `shippingSize`.
 *
 * Safety:
 *  - The old name-guess draft (a "Size guess" column) is refused outright.
 *  - A class or online size someone already set by hand is NOT overwritten unless
 *    `overwrite` is passed — the sheet is a one-off, the editor is the live tool.
 *  - Every write is guarded on the values read at planning time, so an admin edit
 *    between the dry run and --apply is skipped and reported, not clobbered.
 */

import { parse } from 'csv-parse/sync';
import { SHIPPING_SIZE_FIELDS, SHIPPING_SIZE_LIMITS, LISTED_SIZE_SOURCE_MAX } from './shippingSize.js';
import { isShippingClass, suggestShippingClass, SHIPPING_CLASS_LABELS } from './shippingClass.js';

const COLUMN = Object.freeze({
  slug: 'slug',
  shippingClass: 'size class',
  lengthCm: 'length cm',
  breadthCm: 'breadth cm',
  heightCm: 'height cm',
  weightKg: 'weight kg',
  sourceUrl: 'source link',
  estimated: 'estimated',
});

/** What an untouched product's `listedSize` looks like — the rollback target when there was none. */
const EMPTY_LISTED = Object.freeze({
  weightKg: null, lengthCm: null, breadthCm: null, heightCm: null, sourceUrl: null, estimated: false,
});

const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

/** Turn one sheet cell into a class, null ("not sure"/blank), or throw. */
export function parseSheetClass(raw) {
  if (blank(raw)) return null;
  const v = String(raw).trim().toLowerCase();
  if (v.startsWith('not sure')) return null;
  if (isShippingClass(v)) return v;
  throw new Error(`unknown size class "${String(raw).trim()}"`);
}

function parseSizeCells(row) {
  const cells = SHIPPING_SIZE_FIELDS.map((k) => row[k]);
  if (cells.every(blank)) return null;
  if (cells.some(blank)) throw new Error('fill in all four of length, breadth, height and weight, or none');
  const size = {};
  for (const k of SHIPPING_SIZE_FIELDS) {
    // No comma handling: "1,5" could mean 1.5 or 15, and a guess here misprices a parcel.
    const s = String(row[k]).trim();
    const n = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
    const { min, max } = SHIPPING_SIZE_LIMITS[k];
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${k} "${row[k]}" must be a number from ${min} to ${max}`);
    size[k] = n;
  }
  const url = blank(row.sourceUrl) ? null : String(row.sourceUrl).trim();
  if (url && (!/^https?:\/\/\S+$/i.test(url) || url.length > LISTED_SIZE_SOURCE_MAX)) {
    throw new Error('source link must be one http(s) address');
  }
  const est = blank(row.estimated) ? '' : String(row.estimated).trim().toLowerCase();
  return { ...size, sourceUrl: url, estimated: ['yes', 'y', 'true', '1'].includes(est) };
}

/**
 * Parse the CSV text into rows, with per-row errors kept rather than thrown, so a
 * dry run shows every problem at once.
 * @returns {{ rows: Array<{ line, slug, shippingClass, listedSize }>, errors: Array<{ line, slug, error }> }}
 */
export function parseSheet(csvText) {
  const records = parse(csvText, { bom: true, skip_empty_lines: true, relax_column_count: true });
  if (records.length === 0) throw new Error('The sheet is empty.');
  const header = records[0].map(norm);
  if (header.includes('size guess') && !header.includes(COLUMN.shippingClass)) {
    throw new Error('This is the name-guess draft ("Size guess" column). Only a reviewed sheet with a "Size class" column can be loaded.');
  }
  const idx = Object.fromEntries(Object.entries(COLUMN).map(([k, h]) => [k, header.indexOf(h)]));
  if (idx.slug < 0 || idx.shippingClass < 0) throw new Error('The sheet needs "Slug" and "Size class" columns.');

  const rows = [];
  const errors = [];
  const seen = new Map();
  records.slice(1).forEach((rec, i) => {
    const line = i + 2; // 1-based, after the header
    const cell = (k) => (idx[k] >= 0 ? rec[idx[k]] : undefined);
    const slug = String(cell('slug') ?? '').trim();
    if (!slug) { errors.push({ line, slug: '', error: 'no slug' }); return; }
    if (seen.has(slug)) { errors.push({ line, slug, error: `same slug as line ${seen.get(slug)}` }); return; }
    seen.set(slug, line);
    try {
      const listedSize = parseSizeCells(Object.fromEntries(Object.keys(COLUMN).map((k) => [k, cell(k)])));
      rows.push({ line, slug, shippingClass: parseSheetClass(cell('shippingClass')), listedSize });
    } catch (e) {
      errors.push({ line, slug, error: e.message });
    }
  });
  return { rows, errors };
}

const sameListed = (a, b) => [...SHIPPING_SIZE_FIELDS, 'sourceUrl', 'estimated']
  .every((k) => (a?.[k] ?? null) === (b?.[k] ?? null) || (k === 'estimated' && !!a?.[k] === !!b?.[k]));
const hasListed = (l) => !!l && SHIPPING_SIZE_FIELDS.some((k) => l[k] != null);

/**
 * Decide what each row would change. Pure: `products` are the current docs
 * ({ _id, slug, name, shippingClass, shippingClassSource, shippingSize, listedSize }).
 */
export function planImport(rows, products, { overwrite = false } = {}) {
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const plan = { updates: [], notFound: [], unchanged: 0, skippedManual: [], mismatches: [], notSure: 0 };
  for (const row of rows) {
    const p = bySlug.get(row.slug);
    if (!p) { plan.notFound.push(row.slug); continue; }
    if (row.shippingClass === null) plan.notSure += 1;
    const set = {};

    if (row.shippingClass && !(p.shippingClass === row.shippingClass && p.shippingClassSource === 'manual')) {
      if (p.shippingClassSource === 'manual' && p.shippingClass && !overwrite) {
        plan.skippedManual.push({ slug: row.slug, field: 'class', current: p.shippingClass, sheet: row.shippingClass });
      } else {
        set.shippingClass = row.shippingClass;
        set.shippingClassSource = 'manual';
      }
    }
    if (row.listedSize && !sameListed(p.listedSize, row.listedSize)) {
      if (hasListed(p.listedSize) && !overwrite) {
        plan.skippedManual.push({ slug: row.slug, field: 'online size', current: p.listedSize, sheet: row.listedSize });
      } else {
        set.listedSize = row.listedSize;
      }
    }
    // A reviewed class that disagrees with its own size is worth a second look —
    // reported, not overridden: the person who reviewed it may know better.
    if (row.shippingClass && row.listedSize) {
      const suggested = suggestShippingClass({ shippingSize: p.shippingSize, listedSize: row.listedSize });
      if (suggested && suggested !== row.shippingClass) {
        plan.mismatches.push({ slug: row.slug, line: row.line, sheet: row.shippingClass, sizeSays: suggested });
      }
    }

    if (Object.keys(set).length === 0) { plan.unchanged += 1; continue; }
    plan.updates.push({
      _id: p._id,
      slug: p.slug,
      before: {
        shippingClass: p.shippingClass ?? null,
        shippingClassSource: p.shippingClassSource ?? null,
        listedSize: p.listedSize ?? null,
      },
      set,
    });
  }
  return plan;
}

/** Counts per class of what the plan would write, for the dry-run summary. */
export function summarizePlan(plan) {
  const byClass = {};
  for (const u of plan.updates) {
    if (u.set.shippingClass) byClass[SHIPPING_CLASS_LABELS[u.set.shippingClass]] = (byClass[SHIPPING_CLASS_LABELS[u.set.shippingClass]] || 0) + 1;
  }
  return {
    willChange: plan.updates.length,
    classes: byClass,
    onlineSizes: plan.updates.filter((u) => u.set.listedSize).length,
    notSureLeftBlank: plan.notSure,
    unchanged: plan.unchanged,
    notFound: plan.notFound.length,
    skippedAlreadySetByHand: plan.skippedManual.length,
    classDisagreesWithSize: plan.mismatches.length,
  };
}

/** The guard that makes a write a no-op if the product changed after planning. */
function guardFor(before) {
  return {
    shippingClass: before.shippingClass,
    shippingClassSource: before.shippingClassSource,
  };
}

/**
 * Write the plan. Each product is one guarded updateOne; `timestamps: false`
 * because an internal shipping field is not a content change.
 * @returns {{ written: number, changedSincePlan: string[] }}
 */
export async function applyPlan(Product, plan, { batchSize = 200 } = {}) {
  let written = 0;
  const changedSincePlan = [];
  for (let i = 0; i < plan.updates.length; i += batchSize) {
    const batch = plan.updates.slice(i, i + batchSize);
    const res = await Product.bulkWrite(
      batch.map((u) => ({
        updateOne: { filter: { _id: u._id, deletedAt: null, ...guardFor(u.before) }, update: { $set: u.set } },
      })),
      { ordered: false, timestamps: false },
    );
    written += res.modifiedCount;
    if (res.matchedCount < batch.length) {
      const ids = batch.map((u) => u._id);
      const still = await Product.find({ _id: { $in: ids } })
        .select('_id slug shippingClass shippingClassSource').lean();
      const now = new Map(still.map((d) => [String(d._id), d]));
      for (const u of batch) {
        const d = now.get(String(u._id));
        const ok = d && Object.entries(u.set).every(([k, v]) => k === 'listedSize' || d[k] === v);
        if (!ok) changedSincePlan.push(u.slug);
      }
    }
  }
  return { written, changedSincePlan };
}

/** Put back exactly what the backup recorded. Guarded the same way, on the imported values. */
export async function applyRollback(Product, backup, { batchSize = 200 } = {}) {
  let restored = 0;
  for (let i = 0; i < backup.length; i += batchSize) {
    const batch = backup.slice(i, i + batchSize);
    const res = await Product.bulkWrite(
      batch.map((u) => ({
        updateOne: {
          filter: {
            _id: u._id,
            ...(u.set.shippingClass && { shippingClass: u.set.shippingClass, shippingClassSource: 'manual' }),
          },
          update: {
            $set: {
              ...('shippingClass' in u.set && { shippingClass: u.before.shippingClass, shippingClassSource: u.before.shippingClassSource }),
              ...('listedSize' in u.set && { listedSize: u.before.listedSize ?? EMPTY_LISTED }),
            },
          },
        },
      })),
      { ordered: false, timestamps: false },
    );
    restored += res.modifiedCount;
  }
  return { restored };
}
