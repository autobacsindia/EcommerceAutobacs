import sanitizeHtml from 'sanitize-html';

/**
 * Formatted text for staff/admin panel boxes (task notes, comments, follow-up notes…).
 *
 * One field holds either:
 *  - plain text — everything saved before formatting existed, and anything typed
 *    by an older client. It is shown as text (never as HTML), so it can never run.
 *  - formatted HTML — what the rich-text box sends. It always starts with one of
 *    the editor's block tags, which is how the two are told apart. No migration:
 *    old values stay exactly as they are.
 *
 * Every write of formatted HTML goes through `cleanRichText`, which keeps only the
 * tags the editor can make. The browser cleans it again before showing it.
 * Keep the allow-list in step with Front-end/web/src/lib/richText.ts.
 */

const BLOCK_START = /^\s*<(p|h[1-6]|ul|ol|blockquote|pre)(\s[^>]*)?>/i;

/** True when the value is formatted HTML from the rich-text box, false for plain text. */
export function isRichText(value) {
  return typeof value === 'string' && BLOCK_START.test(value);
}

const OPTIONS = {
  allowedTags: [
    'p', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'label', 'input', 'div', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    ul: ['data-type'],
    li: ['data-type', 'data-checked'],
    input: ['type', 'checked', 'disabled'],
    ol: ['start'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { href: attribs.href || '', target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
    // Pasted <h1>/<h4…h6> become the two heading sizes the box offers.
    h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3',
    input: (tagName, attribs) => ({
      tagName,
      attribs: { type: 'checkbox', ...(attribs.checked !== undefined ? { checked: 'checked' } : {}) },
    }),
    ul: (tagName, attribs) => ({ tagName, attribs: attribs['data-type'] === 'taskList' ? { 'data-type': 'taskList' } : {} }),
    li: (tagName, attribs) => ({
      tagName,
      attribs: attribs['data-type'] === 'taskItem'
        ? { 'data-type': 'taskItem', 'data-checked': attribs['data-checked'] === 'true' ? 'true' : 'false' }
        : {},
    }),
  },
  // Drop the contents of things that are never text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'title'],
};

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };

function decodeEntities(s) {
  return s
    .replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

const LIST_LINE = /^(?:• |\d+\. |\[[ x]\] )/;
/** No blank line between two items of one list (each item's paragraph adds one). */
function tightenLists(text) {
  const lines = text.split('\n');
  return lines.filter((line, i) => line !== '' || !(i > 0 && LIST_LINE.test(lines[i - 1]) && LIST_LINE.test(lines[i + 1] ?? ''))).join('\n');
}

/**
 * The words of a value as readable plain text — for emails, pop-ups, the Inbox,
 * list summaries and exports. Lists keep "• " / "1. " / "[x] " markers and links
 * keep their address, so nothing a person wrote is lost.
 */
export function richTextToPlain(value) {
  if (value == null) return '';
  const s = String(value);
  if (!isRichText(s)) return s.trim();
  // Output is only ever used as text, so no clean is needed here (stored values are
  // already clean; measured 6x faster on a 4000-word note than re-cleaning).
  // Never put this function's output into HTML.
  const html = s;
  const counters = [];
  let out = html
    // Checklist items: TipTap writes <li data-type="taskItem" data-checked="true"><label>…</label><div>…</div></li>
    .replace(/<li data-type="taskItem" data-checked="(true|false)">/g, (_, c) => `\n${c === 'true' ? '[x]' : '[ ]'} `)
    .replace(/<label>.*?<\/label>/g, '')
    .replace(/<(ol)(?: start="(\d+)")?>|<\/ol>|<ul[^>]*>|<\/ul>|<li>/g, (m, ol, start) => {
      if (ol) { counters.push(Number(start || 1)); return '\n'; }
      if (m === '</ol>') { counters.pop(); return '\n'; }
      if (m === '<li>') {
        if (counters.length) { const n = counters[counters.length - 1]; counters[counters.length - 1] = n + 1; return `\n${n}. `; }
        return '\n• ';
      }
      return '\n';
    })
    .replace(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/g, (_, href, text) => {
      const words = text.replace(/<[^>]+>/g, '');
      const plainHref = decodeEntities(href).replace(/^mailto:/, '');
      return words && decodeEntities(words) !== plainHref ? `${words} (${href})` : words || href;
    })
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|h2|h3|blockquote|pre)>/g, '\n')
    .replace(/<[^>]+>/g, '');
  out = decodeEntities(out)
    .replace(/[ \t]+\n/g, '\n');
  // Tighten first: one blank line inside a list, several between two lists.
  return tightenLists(out).replace(/\n{3,}/g, '\n\n').trim();
}

/** How many characters of words a value holds — limits count words, not markup. */
export function richTextLength(value) {
  return richTextToPlain(value).length;
}

/**
 * The value to store: plain text trimmed as before, formatted HTML reduced to the
 * allow-list. A formatted value with no words left (an empty paragraph, or nothing
 * but tags that were removed) becomes ''.
 */
export function cleanRichText(value) {
  if (value == null) return '';
  const s = String(value);
  if (!isRichText(s)) return s.trim();
  // Trailing empty lines (the editor keeps one after a list) are not words.
  const clean = sanitizeHtml(s, OPTIONS).trim().replace(/(?:<p>(?:\s|&nbsp;|<br \/>)*<\/p>)+$/, '');
  // Nothing but empty blocks / whitespace → empty.
  const words = clean.replace(/<input[^>]*>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;|\s/g, '');
  if (!words) return '';
  // Cleaning can remove the leading block (e.g. a pasted <section>); keep it recognisably formatted.
  return isRichText(clean) ? clean : `<p>${clean}</p>`;
}

/** Markup may add this much on top of the words before a value is refused outright. */
export const RICH_TEXT_MARKUP_FACTOR = 6;

/**
 * Clean a panel box's value and check its words against `max` in one go, for
 * services that throw their own error: `if (tooLong) throw fail(...)`.
 * A payload far beyond any real note is refused before it is parsed.
 * @returns {{ value: string, tooLong: boolean }}
 */
export function cleanRichTextWithin(raw, max) {
  const s = raw == null ? '' : String(raw);
  if (s.length > Math.max(max * RICH_TEXT_MARKUP_FACTOR, 2000)) return { value: '', tooLong: true };
  const value = cleanRichText(s);
  return { value, tooLong: richTextLength(value) > max };
}
