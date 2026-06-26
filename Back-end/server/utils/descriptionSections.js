/**
 * Parse a WooCommerce product description into a clean intro plus structured
 * "Key Features" and "Why Choose" lists.
 *
 * In WooCommerce these were separate sections (`<h3>Key Features</h3>` + `<p>` items),
 * but the importer flattens the body into one `description` field, mixing the headings
 * inline. This module reconstructs the structured lists so the product page can render
 * them — and so the live WordPress sync (services/wordpressSyncService.js) keeps them
 * split on every import, not just the one-time backfill.
 *
 * Pure + dependency-free so it can be imported by the runtime sync, the migration
 * scripts, and unit tests alike.
 */

const HEADING_KEY_FEATURES = /^key\s+features$/i;
const HEADING_WHY_CHOOSE   = /^why\s+choose\b/i;
// Item title/desc separator the frontend renders/bolds on (spaced en-dash or hyphen).
const SPACED_DASH = /\s[–-]\s/;
// Inline "Capitalized Title:description" on one line (colon instead of dash).
const TITLE_COLON = /^([A-Z][^:]{1,60}?):\s*(\S[\s\S]*)$/;
// A line that is ONLY a title — "Advanced Foam Cell Technology:" — whose description
// follows on the next block(s).
const BARE_TITLE = /^[A-Z][^:\n]{1,80}:$/;

/** Strip HTML tags and decode the handful of entities WooCommerce emits. */
export function stripTags(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksLikeHtml(s) {
  return /<\/?(h[1-6]|p|ul|ol|li|div|strong|br|span)\b/i.test(s || '');
}

// Normalize an item to the "Title – desc" shape the frontend renders/bolds on.
function normalizeItem(item) {
  const t = item.replace(/\s+/g, ' ').trim();
  if (SPACED_DASH.test(t)) return t;
  const m = t.match(TITLE_COLON);
  return m ? `${m[1].trim()} – ${m[2].trim()}` : t;
}

// Split a single line that packs multiple "Title:desc" points into separate items.
function explodeInlineTitles(block) {
  const re = /(^|[.!?]\s+)([A-Z][^:\n]{2,60}?:)/g;
  const starts = [];
  let m;
  while ((m = re.exec(block)) !== null) starts.push(m.index + m[1].length);
  if (starts.length <= 1) return [block.trim()].filter(Boolean);
  const parts = [];
  const head = block.slice(0, starts[0]).trim();
  if (head) parts.push(head); // text before the first title (rare)
  for (let i = 0; i < starts.length; i++) {
    const stop = i + 1 < starts.length ? starts[i + 1] : block.length;
    parts.push(block.slice(starts[i], stop).trim());
  }
  return parts.filter(Boolean);
}

/**
 * Assemble flattened blocks into clean "Title – desc" items, handling every shape:
 *   • "Title – desc" on one line                  → one item
 *   • "Title:desc" on one line                    → one item (colon → dash)
 *   • "Title:" on its own line, desc on the next  → title + following line(s)
 *   • multiple "Title:desc" on a single line      → split into several items
 *   • a plain follow-up sentence                  → folded into the previous item
 */
export function coalesceItems(items) {
  const blocks = items.flatMap((raw) => explodeInlineTitles((raw || '').replace(/\s+/g, ' ').trim()));

  const assembled = []; // { title, desc } | { whole }
  for (const block of blocks) {
    if (!block) continue;
    if (BARE_TITLE.test(block)) {
      assembled.push({ title: block.replace(/:\s*$/, '').trim(), desc: '' });
    } else if (SPACED_DASH.test(block) || TITLE_COLON.test(block)) {
      assembled.push({ whole: block });
    } else {
      const last = assembled[assembled.length - 1];
      if (last && last.title !== undefined) {
        last.desc = last.desc ? `${last.desc} ${block}` : block;
      } else if (last && last.whole !== undefined) {
        last.whole = `${last.whole} ${block}`;
      } else {
        assembled.push({ whole: block });
      }
    }
  }

  return assembled
    .map((it) => (it.whole !== undefined
      ? normalizeItem(it.whole)
      : normalizeItem(it.desc ? `${it.title} – ${it.desc}` : it.title)))
    .filter(Boolean);
}

/** Parse an HTML description into ordered blocks: { type: 'heading'|'item', text }. */
export function htmlBlocks(html) {
  const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) blocks.push({ type: 'heading', text: stripTags(m[2]) });
    else blocks.push({ type: 'item', text: stripTags(m[3] ?? m[4] ?? '') });
  }
  return blocks;
}

/** Parse a flattened text description into ordered blocks (each non-empty line). */
export function textBlocks(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => (
      (HEADING_KEY_FEATURES.test(line) || HEADING_WHY_CHOOSE.test(line))
        ? { type: 'heading', text: line }
        : { type: 'item', text: line }
    ));
}

/**
 * Walk ordered blocks through a Key-Features / Why-Choose state machine.
 * Returns { description, features, whyChoose, matched } where `matched` indicates at
 * least one of the two headings was found.
 */
export function partition(blocks, productName) {
  const introParts = [];
  const features = [];
  const whyChoose = [];
  let section = 'intro';
  let matched = false;
  const nameNorm = (productName || '').trim().toLowerCase();

  for (const b of blocks) {
    if (b.type === 'heading') {
      if (HEADING_KEY_FEATURES.test(b.text)) { section = 'features'; matched = true; continue; }
      if (HEADING_WHY_CHOOSE.test(b.text))   { section = 'whyChoose'; matched = true; continue; }
      if (b.text && b.text.trim().toLowerCase() !== nameNorm && section === 'intro') {
        introParts.push(b.text);
      }
      continue;
    }
    if (section === 'features') features.push(b.text);
    else if (section === 'whyChoose') whyChoose.push(b.text);
    else {
      if (introParts.length === 0 && b.text.trim().toLowerCase() === nameNorm) continue;
      introParts.push(b.text);
    }
  }

  return {
    description: introParts.join('\n\n').trim(),
    features: coalesceItems(features),
    whyChoose: coalesceItems(whyChoose),
    matched,
  };
}

/**
 * Convenience: parse a raw WooCommerce description (HTML or flattened text) into
 * { matched, description, features, whyChoose }. Auto-detects the format.
 */
export function splitDescriptionSections(rawDescription, productName) {
  const desc = rawDescription || '';
  const blocks = looksLikeHtml(desc) ? htmlBlocks(desc) : textBlocks(desc);
  return partition(blocks, productName);
}
