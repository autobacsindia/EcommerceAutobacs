import mongoose from 'mongoose';

/**
 * Search / sort / filter building blocks for the staff and admin lists — one
 * reading of the query string, so "search", "from", "min" and "sort" mean the
 * same thing on every list. Each list picks the pieces it needs and says which
 * fields they apply to; nothing here knows about any one collection.
 *
 *   q          — words, case-insensitive; EVERY word must appear somewhere
 *                ("kochi fuel" narrows, it does not widen). Regex-escaped.
 *   from / to  — YYYY-MM-DD, India time, both days included
 *   min / max  — rupees, inclusive
 *   sort       — one of the list's own sort names
 *   cursor     — the opaque position the previous page ended on (keyset, never skip)
 */

export const MAX_SEARCH = 60;
const MAX_WORDS = 5;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The search words (lower-case, at most five), or [] when nothing was typed. */
export function searchWords(q) {
  return String(q ?? '').trim().toLowerCase().slice(0, MAX_SEARCH)
    .split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
}

/** "4,500", "₹4500", "4500.50" → 4500 / 4500.5; anything else → null. */
export function amountOf(word) {
  const s = String(word).replace(/[₹,]/g, '').replace(/^rs\.?/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * One Mongo clause per word: the word in any of `fields`, plus whatever
 * `extra(word)` adds for that word (an exact amount, say). AND-ed together.
 */
export function searchClauses(words, fields, extra = () => []) {
  return words.map((w) => {
    const re = new RegExp(escapeRegex(w), 'i');
    return { $or: [...fields.map((f) => ({ [f]: re })), ...extra(w)] };
  });
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Midnight India time at the start of a YYYY-MM-DD day, or null. */
export function istDayStart(ymd) {
  const m = YMD.exec(String(ymd ?? ''));
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(utc);
  // Reject 2026-02-31 and friends rather than rolling them into March.
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return new Date(utc - IST_OFFSET_MS);
}

/** { $gte, $lt } for an India-time day range (either end optional), or null. */
export function istRange(from, to) {
  const start = istDayStart(from);
  const endDay = istDayStart(to);
  if (!start && !endDay) return null;
  return {
    ...(start ? { $gte: start } : {}),
    ...(endDay ? { $lt: new Date(endDay.getTime() + DAY_MS) } : {}),
  };
}

/** { $gte, $lte } for rupee bounds (either optional), or null. */
export function amountRange(min, max) {
  const lo = min === '' || min == null ? null : Number(min);
  const hi = max === '' || max == null ? null : Number(max);
  const ok = (n) => n !== null && Number.isFinite(n) && n >= 0;
  if (!ok(lo) && !ok(hi)) return null;
  return { ...(ok(lo) ? { $gte: lo } : {}), ...(ok(hi) ? { $lte: hi } : {}) };
}

export const isObjectId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);

/*
  Keyset pages for any single-field sort, with _id as the tie-breaker.

  A sort is { field, dir, type } — type 'date' | 'number' — and the cursor is
  the sort name plus the last row's value and id, so a cursor made under one
  sort is never read under another (it is ignored and the list starts again
  from the top, which is the honest answer).
*/

const get = (row, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), row);

export function encodeCursor(sortName, sort, row) {
  const v = get(row, sort.field);
  const value = sort.type === 'date' ? new Date(v).toISOString() : sort.type === 'string' ? String(v ?? '') : Number(v);
  return Buffer.from(JSON.stringify([sortName, value, String(row._id)])).toString('base64url');
}

export function decodeCursor(sortName, sort, cursor) {
  if (!cursor) return null;
  try {
    const [name, raw, id] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString());
    if (name !== sortName || !isObjectId(id)) return null;
    if (sort.type === 'string') return typeof raw === 'string' ? { value: raw, id: new mongoose.Types.ObjectId(id) } : null;
    const value = sort.type === 'date' ? new Date(raw) : Number(raw);
    if (sort.type === 'date' ? Number.isNaN(value.getTime()) : !Number.isFinite(value)) return null;
    return { value, id: new mongoose.Types.ObjectId(id) };
  } catch { return null; }
}

/*
  A sort is { field, dir, type } and pages on [field, _id], so equal values never
  repeat or skip a row. A sort on a field the schema makes unique can say
  `unique: true`: it then needs no _id tie-breaker, and an index on just
  [..., field] serves it (with the tie-breaker the planner sorts in memory).
*/

/** The clause that starts the page after `after`, in `sort` order. */
export function afterClause(sort, after) {
  if (!after) return null;
  const op = sort.dir < 0 ? '$lt' : '$gt';
  if (sort.unique) return { [sort.field]: { [op]: after.value } };
  return { $or: [{ [sort.field]: { [op]: after.value } }, { [sort.field]: after.value, _id: { [op]: after.id } }] };
}

/** The Mongo sort object for a sort. */
export const sortSpec = (sort) => (sort.unique ? { [sort.field]: sort.dir } : { [sort.field]: sort.dir, _id: sort.dir });

/** Ands the non-empty clauses; {} when there are none. */
export function and(...clauses) {
  const list = clauses.flat().filter((c) => c && Object.keys(c).length);
  if (!list.length) return {};
  return list.length === 1 ? list[0] : { $and: list };
}

/** A query string with repeated keys (?q=a&q=b) read as their first value, and nested objects dropped. */
export function plainQuery(query = {}) {
  const out = {};
  for (const [k, v] of Object.entries(query || {})) {
    const one = Array.isArray(v) ? v[0] : v;
    if (typeof one === 'string') out[k] = one;
  }
  return out;
}

/**
 * One keyset page of a list, plus — on the first page only — how many match.
 *
 *   find(query, { sort, limit })  the repository's page read
 *   count(query)                  optional; the repository's capped count / total
 *
 * Returns { items, nextCursor, sort, summary? }. `sortName` must already be one
 * of `sorts` (the caller decides what an unknown or inapplicable sort becomes).
 */
export async function keysetPage({ query, sorts, sortName, cursor, pageSize, find, count = null }) {
  const sort = sorts[sortName];
  const after = decodeCursor(sortName, sort, cursor);
  const [rows, summary] = await Promise.all([
    find(and(query, afterClause(sort, after)), { sort: sortSpec(sort), limit: pageSize + 1 }),
    after || !count ? null : count(query),
  ]);
  const items = rows.slice(0, pageSize);
  return {
    items,
    nextCursor: rows.length > pageSize ? encodeCursor(sortName, sort, items[items.length - 1]) : null,
    sort: sortName,
    ...(summary ? { summary } : {}),
  };
}

/** The aggregate stages for a capped count and total of `sumField` (null: count only). */
export const summaryPipeline = (query, cap, sumField = null) => [
  { $match: query },
  { $limit: cap + 1 },
  { $group: { _id: null, count: { $sum: 1 }, ...(sumField ? { total: { $sum: `$${sumField}` } } : {}) } },
];

/** Reads the aggregate's one row: over the cap → { count: cap, capped: true, total: null }. */
export function readSummary(row, cap, withTotal) {
  const count = row?.count || 0;
  if (count > cap) return { count: cap, capped: true, ...(withTotal ? { total: null } : {}) };
  return { count, capped: false, ...(withTotal ? { total: Math.round((row?.total || 0) * 100) / 100 } : {}) };
}
