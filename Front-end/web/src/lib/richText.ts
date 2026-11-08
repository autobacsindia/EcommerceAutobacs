import DOMPurify from 'dompurify';

/**
 * Formatted text in panel boxes. A field holds either plain text (everything
 * saved before formatting existed) or HTML from <RichTextBox>, which always
 * starts with one of the editor's block tags. Plain text is shown as text and
 * never parsed as HTML. Keep the allow-list in step with
 * Back-end/server/utils/richText.js — the server cleans on save, this cleans
 * again before anything is put on screen.
 */

const BLOCK_START = /^\s*<(p|h[1-6]|ul|ol|blockquote|pre)(\s[^>]*)?>/i;

export function isRichText(value: unknown): boolean {
  return typeof value === 'string' && BLOCK_START.test(value);
}

const ALLOWED_TAGS = [
  'p', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'label', 'input', 'div', 'span',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'data-type', 'data-checked', 'type', 'checked', 'disabled', 'start'];

let hooked = false;
function purifier() {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
      if (node.tagName === 'INPUT') {
        if (node.getAttribute('type') !== 'checkbox') node.setAttribute('type', 'checkbox');
        // Shown, not ticked from here: ticking happens in the editor.
        node.setAttribute('disabled', '');
      }
    });
  }
  return DOMPurify;
}

/** Formatted HTML reduced to what the box can make. Plain text must not be passed here — use isRichText first. */
export function sanitizeRichHtml(html: string): string {
  // Panel text is fetched in the browser; with no DOM (server render) show nothing rather than anything unchecked.
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return '';
  return purifier().sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
  }) as string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * What to load into the editor: formatted values as they are, old plain text as
 * paragraphs (one per line), with every character kept literally.
 */
export function toEditorHtml(value: string | null | undefined): string {
  const v = value ?? '';
  if (!v.trim()) return '';
  if (isRichText(v)) return v;
  return v.split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

const LIST_LINE = /^(?:• |\d+\. |\[[ x]\] )/;
/** No blank line between two items of one list (each item's paragraph adds one). */
function tightenLists(text: string) {
  const lines = text.split('\n');
  return lines.filter((line, i) => line !== '' || !(i > 0 && LIST_LINE.test(lines[i - 1]) && LIST_LINE.test(lines[i + 1] ?? ''))).join('\n');
}

/**
 * The words as readable plain text, for previews, list summaries, copy and
 * "N characters left". Matches the server's richTextToPlain closely enough for
 * counting; the server's count is the one that is enforced.
 */
export function richTextToPlain(value: string | null | undefined): string {
  const v = value ?? '';
  if (!isRichText(v)) return v.trim();
  const counters: number[] = [];
  // Text out, never HTML: no clean needed (it runs on every keystroke for the empty check).
  let out = v
    .replace(/<li data-type="taskItem" data-checked="(true|false)">/g, (_m, c) => `\n${c === 'true' ? '[x]' : '[ ]'} `)
    .replace(/<label>.*?<\/label>/g, '')
    .replace(/<ol(?: start="(\d+)")?>|<\/ol>|<ul[^>]*>|<\/ul>|<li>/g, (m, start) => {
      if (m.startsWith('<ol')) { counters.push(Number(start || 1)); return '\n'; }
      if (m === '</ol>') { counters.pop(); return '\n'; }
      if (m === '<li>') {
        if (counters.length) { const n = counters[counters.length - 1]; counters[counters.length - 1] = n + 1; return `\n${n}. `; }
        return '\n• ';
      }
      return '\n';
    })
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|h2|h3|blockquote|pre)>/g, '\n')
    .replace(/<[^>]+>/g, '');
  out = out
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n');
  // Tighten first: one blank line inside a list, several between two lists.
  return tightenLists(out).replace(/\n{3,}/g, '\n\n').trim();
}

/** True when a value has no words (empty, or only empty formatting). */
export function isRichTextEmpty(value: string | null | undefined): boolean {
  return !richTextToPlain(value).replace(/\[[ x]\]|•/g, '').trim();
}
