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

  A sort is { field, dir, type } — type 'date' | 'number' | 'string' | 'objectId'
  (the last for a sort on _id itself, with `unique: true`) — and the cursor is
  the sort name plus the last row's value and id, so a cursor made under one
  sort is never read under another (it is ignored and the list starts again
  from the top, which is the honest answer).
*/

const get = (row, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), row);

export function encodeCursor(sortName, sort, row) {
  const v = get(row, sort.field);
  const value = sort.type === 'date' ? new Date(v).toISOString()
    : sort.type === 'string' || sort.type === 'objectId' ? String(v ?? '') : Number(v);
  return Buffer.from(JSON.stringify([sortName, value, String(row._id)])).toString('base64url');
}

export function decodeCursor(sortName, sort, cursor) {
  if (!cursor) return null;
  try {
    const [name, raw, id] = JSON.parse(Buffer.from(String(cursor), 'base64url').toString());
    if (name !== sortName || !isObjectId(id)) return null;
    if (sort.type === 'string') return typeof raw === 'string' ? { value: raw, id: new mongoose.Types.ObjectId(id) } : null;
    if (sort.type === 'objectId') return isObjectId(raw) ? { value: new mongoose.Types.ObjectId(raw), id: new mongoose.Types.ObjectId(id) } : null;
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

/**
  The clause that starts the page after `after`, in `sort` order (newest first:
  older than the last row, or as old and with a smaller _id).

  Written as `field ≤ value, but not (field = value and _id ≥ id)` rather than the
  textbook `field < value or (field = value and _id < id)`: the same rows, but
  MongoDB 7.0 splits that $or into separate index scans and sorts every row they
  find in memory (16,000 orders read for page 2 of Order processing, measured),
  whereas a $nor is only ever a filter, so the plan stays an ordered walk of the
  index from `value` on. A row missing the field is outside both forms.
*/
export function afterClause(sort, after) {
  if (!after) return null;
  const desc = sort.dir < 0;
  if (sort.unique) return { [sort.field]: { [desc ? '$lt' : '$gt']: after.value } };
  return {
    [sort.field]: { [desc ? '$lte' : '$gte']: after.value },
    $nor: [{ [sort.field]: after.value, _id: { [desc ? '$gte' : '$lte']: after.id } }],
  };
}

/** The Mongo sort object for a sort. */
export const sortSpec = (sort) => (sort.unique ? { [sort.field]: sort.dir } : { [sort.field]: sort.dir, _id: sort.dir });

/**
  (A or B) and X  →  (A and X) or (B and X): the same rows, but with the $or at
  the top, where MongoDB can serve each branch from its own (partial) index and
  merge them in sort order. Inside an $and it cannot, and falls back to whatever
  index the other conditions offer, sorting in memory.

  `query` is what keysetPage was given ({ $or: [...] }); `q` is what it asks the
  repository for — `query` itself on page 1, { $and: [query, cursor] } after.
*/
export function orPerBranch(q, query) {
  if (!Array.isArray(query?.$or)) return q;
  if (q === query) return q;
  if (!Array.isArray(q?.$and) || q.$and[0] !== query) return q;
  const rest = q.$and.slice(1);
  return { $or: query.$or.map((branch) => and(branch, ...rest)) };
}

/** Compares two rows by a Mongo sort object ({ createdAt: -1, _id: -1 }); missing values first, as in MongoDB. */
export function compareBySort(sort) {
  const keyOf = (v) => (v instanceof Date ? v.getTime() : v instanceof mongoose.Types.ObjectId ? String(v) : v);
  return (a, b) => {
    for (const [path, dir] of Object.entries(sort)) {
      const x = keyOf(get(a, path));
      const y = keyOf(get(b, path));
      if (x === y) continue;
      if (x == null) return -dir;
      if (y == null) return dir;
      return (x < y ? -1 : 1) * dir;
    }
    return 0;
  };
}

/**
  One page of an $or list, read branch by branch: each branch is its own find with
  the sort and the limit, and the rows are merged in sort order, a row matched by
  two branches kept once. For keysetPage's `find`, given `query` (keysetPage's) and
  `q` (what keysetPage asks for).

  Why not one find of the $or: MongoDB plans each branch of an $or without the sort,
  so it may give a branch an index that does not keep the rows in order — and then
  sort every matching row in memory. Measured on 7.0 with Order processing's
  sales-panel branch: whether it did depended on the data. A branch planned with
  the sort and a limit picks the index that is already in order every time (that
  plan returns rows at once; one that must sort first returns none until it has
  read everything). The page holds at most `limit` rows from each branch, which is
  all the merged page can need.
*/
export async function findEachBranch(q, query, { sort, limit }, find) {
  if (!Array.isArray(query?.$or)) return find(q, { sort, limit, branch: 0 });
  const lists = await Promise.all(orPerBranch(q, query).$or.map((branch, i) => find(branch, { sort, limit, branch: i })));
  const seen = new Set();
  return lists.flat().sort(compareBySort(sort)).filter((row) => {
    const id = String(row._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, limit);
}

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
