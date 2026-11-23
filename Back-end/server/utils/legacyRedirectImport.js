import { normalizePath, normalizeTarget } from './redirectPaths.js';

/**
 * Turns the reviewed /model/<keyword> sheet (Search Console 404 export, one row
 * per old WordPress landing page) into redirect-table rows. Pure, so every rule
 * is tested without a database; scripts/import-legacy-redirects.js does the I/O.
 *
 * Sheet columns (header names matter, order does not):
 *   old_url            the dead URL
 *   today              "already redirects" | "404 today"
 *   suggested_target   the machine suggestion
 *   approved_target    the reviewer's answer:
 *                        keep       → use suggested_target
 *                        GONE       → 410 (Google drops it)
 *                        /products/… | /categories/… | /model/<vehicle> → that page
 *                        (empty)    → not reviewed, skipped
 *
 * A row is only ever written when the reviewer filled it in, and only to a page
 * that is live right now — a redirect into a 404 is the bug we are fixing.
 */

export const IMPORT_SOURCE = 'legacy';
const GONE = /^gone(\s*\(410\))?$/i;
const SECTIONS = { products: 'products', categories: 'categories', model: 'vehicles' };

/** Resolve the reviewer's answer to a target path, null (410), or an error string. */
function resolveTarget(row) {
  const approved = String(row.approved_target ?? '').trim();
  if (!approved) return { skip: 'not reviewed' };
  let answer = approved;
  if (/^keep$/i.test(approved)) {
    if (/already redirects/i.test(String(row.today ?? ''))) return { skip: 'already redirects today; nothing to store' };
    answer = String(row.suggested_target ?? '').trim();
  }
  if (GONE.test(answer)) return { toPath: null };
  const toPath = normalizeTarget(answer);
  if (!toPath) return { error: `not one of our pages: "${answer}"` };
  return { toPath };
}

/**
 * @param rows      parsed sheet rows (objects keyed by header)
 * @param live      { products:Set, categories:Set, vehicles:Set } of live slugs
 * @param existing  Map<fromPath, { toPath, source }> rows already in the table
 * @returns { writes:[{fromPath,toPath}], unchanged:[], skipped:[{fromPath,reason}], errors:[{fromPath,reason}] }
 */
export function planLegacyImport(rows, live, existing = new Map()) {
  const out = { writes: [], unchanged: [], skipped: [], errors: [] };
  const seen = new Map();
  for (const row of rows) {
    // Unreviewed / already-redirecting rows are skipped before any validation, so
    // a row nobody asked us to write can never block --apply.
    const t = resolveTarget(row);
    if (t.skip) { out.skipped.push({ fromPath: row.old_url, reason: t.skip }); continue; }

    const fromPath = normalizePath(String(row.old_url ?? ''));
    if (!fromPath || !fromPath.startsWith('/model/') || fromPath.split('/').length !== 3) {
      out.errors.push({ fromPath: row.old_url, reason: 'old_url is not a /model/<keyword> URL' });
      continue;
    }
    const slug = fromPath.split('/')[2];
    if (live.vehicles.has(slug)) { out.skipped.push({ fromPath, reason: 'a live vehicle page now' }); continue; }
    if (t.error) { out.errors.push({ fromPath, reason: t.error }); continue; }

    const { toPath } = t;
    if (toPath !== null) {
      const [, section, target, extra] = toPath.split('/');
      const set = live[SECTIONS[section]];
      if (!set || extra !== undefined) { out.errors.push({ fromPath, reason: `target must be /products/, /categories/ or /model/<vehicle>: ${toPath}` }); continue; }
      if (!set.has(target)) { out.errors.push({ fromPath, reason: `target is not a live page: ${toPath}` }); continue; }
      if (toPath === fromPath) { out.errors.push({ fromPath, reason: 'redirects to itself' }); continue; }
    }

    if (seen.has(fromPath)) {
      if (seen.get(fromPath) !== toPath) out.errors.push({ fromPath, reason: 'listed twice with different targets' });
      continue;
    }
    seen.set(fromPath, toPath);

    const prev = existing.get(fromPath);
    if (prev && prev.source !== IMPORT_SOURCE) { out.skipped.push({ fromPath, reason: `set by an admin (${prev.source}); left alone` }); continue; }
    if (prev && (prev.toPath ?? null) === toPath) { out.unchanged.push({ fromPath, toPath }); continue; }
    out.writes.push({ fromPath, toPath, previous: prev ? (prev.toPath ?? null) : undefined });
  }
  // A path listed twice with different targets must not be half-written.
  const clashes = new Set(out.errors.filter((e) => e.reason.startsWith('listed twice')).map((e) => e.fromPath));
  if (clashes.size) out.writes = out.writes.filter((w) => !clashes.has(w.fromPath));
  return out;
}
