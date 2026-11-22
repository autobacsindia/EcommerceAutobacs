/**
 * Path rules for the redirect table (models/Redirect.js). Pure, so the rules are
 * tested without a database, and shared by the admin write paths and the map
 * endpoint so a row is judged the same way on the way in and on the way out.
 */

export const MAX_PATH_LENGTH = 300;

/**
 * The stored form of an old URL: lowercase, leading slash, no trailing slash,
 * no query or fragment, percent-escapes decoded. Accepts a full URL on our own
 * host too (admins paste those). Returns null for anything that is not a path.
 */
export function normalizePath(input) {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      return null;
    }
  }
  raw = raw.split(/[?#]/)[0];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* malformed escape: keep it as typed */
  }
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\s\\<>"]/.test(raw)) return null;
  const path = raw.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  if (path.length > MAX_PATH_LENGTH) return null;
  return path;
}

/** A redirect target must be one of our own pages, never another site. */
export function normalizeTarget(input) {
  if (input === null) return null;
  const path = normalizePath(input);
  return path && path !== '/' ? path : undefined;
}

/**
 * Collapse redirect chains so every old URL answers in ONE hop, and drop rows
 * that would hide a live page or loop.
 *
 *   paths    Map<fromPath, toPath|null>   (null = 410 Gone)
 *   isLive   (path) => boolean            a page that currently answers 200
 *   rename   (path) => path|null          the slug-history rename of a path, if any
 *
 * Returns a plain object { fromPath: toPath|null }.
 */
export function finalizePathMap(paths, { isLive = () => false, rename = () => null } = {}) {
  const out = {};
  for (const [from, first] of paths) {
    if (isLive(from)) continue; // a live page always wins over an old row
    let to = first;
    const seen = new Set([from]);
    let ok = true;
    for (let hop = 0; to !== null && hop < 10; hop += 1) {
      const renamed = rename(to);
      if (renamed && renamed !== to) to = renamed;
      if (seen.has(to)) { ok = false; break; } // loop
      if (isLive(to) || !paths.has(to)) break;
      seen.add(to);
      to = paths.get(to);
    }
    // Still mid-chain after 10 hops: too long to trust, skip it.
    if (to !== null && paths.has(to) && !isLive(to)) ok = false;
    if (ok && to !== from) out[from] = to;
  }
  return out;
}
