/**
 * Extract "Package Includes" pointers from a WooCommerce product's custom tabs.
 *
 * The YIKES Custom Product Tabs plugin stores tabs in the `yikes_woo_products_tabs`
 * meta as an array of { title, id, content } where content is HTML — almost always
 * a `<ul><li>…</li></ul>` list (sometimes nested, sometimes with a heading). We keep
 * only the package tabs and return the leaf `<li>` items as an array of strings
 * (POINTERS, never a paragraph), so the PDP can render a clean bulleted list.
 *
 * Shared by the live sync (wordpressSyncService) and the backfill script.
 * Pure + deterministic — no I/O.
 */
import { load as loadHtml } from 'cheerio';
import { decodeEntities } from './wcVariants.js';

// A tab whose content is package contents. Matches titles starting with "Package"
// (Package, Package Includes, PACKAGE INCLUDES, Package includes, Package details)
// or "kit" (one mislabeled product whose content is a "Package Includes:" list).
// Deliberately EXCLUDES Compatibility, spec/table tabs, Important, Accessories.
const PACKAGE_TAB_RE = /^(package|kit)\b/i;

export function isPackageTab(title) {
  return PACKAGE_TAB_RE.test(String(title || '').trim());
}

/**
 * Parse one tab's HTML into an array of pointer strings.
 * - Prefers LEAF <li> items (an <li> that only wraps a nested <ul>/<ol> is skipped
 *   so we don't emit the whole sublist as one blob).
 * - Falls back to <br>/newline-split lines when the content has no list at all.
 * - Drops a leading "Package Includes:"-style heading and any blank items.
 */
export function parseTabToPointers(html) {
  if (!html) return [];
  const $ = loadHtml(`<root>${String(html)}</root>`);

  const clean = (s) => decodeEntities(String(s || '').replace(/\s+/g, ' ')).trim();

  const leaves = [];
  $('li').each((_, el) => {
    const $el = $(el);
    // Skip wrapper <li> that only exists to hold a nested list.
    if ($el.children('ul, ol').length > 0 && !$el.clone().children('ul, ol').remove().end().text().trim()) {
      return;
    }
    const text = clean($el.text());
    if (text) leaves.push(text);
  });

  let items = leaves;
  if (items.length === 0) {
    // No list markup — split the visible text into lines (br / newlines).
    const text = $('root').html() || '';
    items = text
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(p|div|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .split(/\n+/)
      .map(clean);
  }

  // Drop blanks and heading-only lines like "Package Includes" / "Package Includes:".
  return items.filter((x) => x && !/^package\s*(includes|details)?\s*:?$/i.test(x));
}

/**
 * @param {Array} metaData - the WC product's `meta_data` array
 * @returns {string[]} deduped package-content pointers (order preserved)
 */
export function extractPackageContents(metaData = []) {
  const md = (metaData || []).find((m) => m && m.key === 'yikes_woo_products_tabs');
  const tabs = Array.isArray(md?.value) ? md.value : [];
  const items = [];
  for (const t of tabs) {
    if (isPackageTab(t?.title)) items.push(...parseTabToPointers(t?.content));
  }
  // De-dupe while preserving first-seen order (a product may carry both a
  // "Package" and a "Package Includes" tab with overlapping lines).
  return [...new Set(items)];
}

export default extractPackageContents;
