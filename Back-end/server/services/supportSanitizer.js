/**
 * Inbound-email sanitisation, quote stripping and auto-reply detection.
 *
 * THREAT MODEL
 * ------------
 * Everything this module touches is attacker-controlled. Anyone on the internet
 * can send mail to support@ containing arbitrary HTML, and the result is
 * rendered in the ADMIN panel — inside an authenticated session that can refund
 * money, edit prices and read every customer record. A stored-XSS here is a
 * full admin compromise, so this is the highest-risk code in the support
 * feature.
 *
 * Defence is layered, because any single layer can be bypassed:
 *   1. Server-side allowlist sanitisation (this module) — no script, no form,
 *      no event handlers, no javascript:/data: URLs.
 *   2. Remote images neutered — an <img src="https://attacker/x.png"> in an
 *      email is a tracking pixel that reports when an agent opened the ticket
 *      and leaks the admin's IP. `src` is moved to `data-blocked-src` so the UI
 *      can offer an explicit "load images" action.
 *   3. The admin UI renders the result in a SANDBOXED IFRAME, so even a bypass
 *      cannot reach the parent page's DOM, cookies or the CSP nonce.
 *
 * The plain-text body is always preferred where it is sufficient. `bodyHtml` is
 * a convenience for reading formatted mail, never the canonical record.
 */

import sanitizeHtml from 'sanitize-html';

/**
 * Sentinel injected into every outbound support email. Customers reply above it,
 * so cutting the text here removes the entire quoted history exactly — far more
 * reliable than guessing at client-specific quote markers. The heuristics below
 * exist only for mail that predates the sentinel or strips it.
 */
export const REPLY_SENTINEL = '##- Please type your reply above this line -##';

/**
 * Client-specific quoted-history markers, tried in order when the sentinel is
 * absent. Each regex must match the START of the quoted block; everything from
 * the match onward is discarded.
 */
const QUOTE_MARKERS = [
  // Gmail / Apple Mail: "On Mon, 4 Aug 2026 at 10:30, Jane <j@x.com> wrote:"
  /^\s*On\b.{0,200}?\bwrote:\s*$/im,
  // Outlook (English) and the long underscore rule it draws above the quote
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{10,}\s*$/m,
  // Outlook header block
  /^\s*From:.*$\n^\s*Sent:.*$/im,
  // Common localisations / mobile clients
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^\s*Sent from my \w+/im,
  /^\s*Begin forwarded message:\s*$/im,
];

/**
 * Strip quoted history from a plain-text email body.
 *
 * Deliberately conservative: if stripping would leave nothing, the original is
 * returned instead. A customer whose entire message is "yes please" under a
 * quote block must not end up with an empty ticket message — an over-eager
 * stripper loses real content, which is worse than showing a little extra.
 *
 * @param {string} text
 * @returns {string}
 */
export const stripQuotedText = (text = '') => {
  const input = String(text || '');
  if (!input.trim()) return '';

  // 1. Our own sentinel wins — it is exact.
  const sentinelAt = input.indexOf(REPLY_SENTINEL);
  if (sentinelAt > -1) {
    const cut = input.slice(0, sentinelAt).trim();
    if (cut) return cut;
  }

  // 2. Earliest client-specific marker.
  let earliest = -1;
  for (const marker of QUOTE_MARKERS) {
    const match = input.match(marker);
    if (match?.index !== undefined && (earliest === -1 || match.index < earliest)) {
      earliest = match.index;
    }
  }
  if (earliest > 0) {
    const cut = input.slice(0, earliest).trim();
    if (cut) return cut;
  }

  // 3. Trailing run of ">" quoted lines.
  const lines = input.split('\n');
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (line === '' || line.startsWith('>')) { end -= 1; continue; }
    break;
  }
  if (end > 0 && end < lines.length) {
    const cut = lines.slice(0, end).join('\n').trim();
    if (cut) return cut;
  }

  return input.trim();
};

/**
 * Sanitise inbound email HTML for rendering inside the admin's sandboxed iframe.
 *
 * @param {string} dirty
 * @returns {string} safe HTML (empty string for empty input)
 */
export const sanitizeEmailHtml = (dirty) => {
  if (!dirty || typeof dirty !== 'string') return '';

  return sanitizeHtml(dirty, {
    allowedTags: [
      'p', 'br', 'hr', 'span', 'div',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
      'a', 'img',
      // Marketing and signature blocks are table-based; without these the mail
      // is unreadable. Tables carry no script capability once attributes are
      // allowlisted.
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    ],
    // Everything not listed is dropped, which is what removes <script>, <style>,
    // <iframe>, <object>, <embed>, <base>, <meta>, <link>, and — critically —
    // <form>/<input>/<button>, so a phishing form cannot be rendered inside an
    // authenticated admin page.
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['alt', 'title', 'width', 'height', 'data-blocked-src'],
      td: ['colspan', 'rowspan', 'align', 'valign'],
      th: ['colspan', 'rowspan', 'align', 'valign'],
      table: ['align', 'width'],
      '*': ['style'],
    },
    // No `data:` — it is a common XSS and exfiltration vector in mail, and
    // legitimate inline images arrive as CID attachments we handle separately.
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    // Any URL-bearing attribute must use an allowed scheme, closing the
    // `javascript:` gap on attributes other than href.
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'action'],
    // A tight style allowlist keeps mail legible while blocking the CSS tricks
    // that matter — position/z-index overlays, and url() references that would
    // beacon on render.
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        'text-align': [/^(left|right|center|justify)$/i],
        'font-weight': [/^(normal|bold|[1-9]00)$/i],
        'font-style': [/^(normal|italic)$/i],
        'text-decoration': [/^(none|underline|line-through)$/i],
        'font-size': [/^\d{1,2}(px|pt|em|rem|%)$/i],
        padding: [/^[\d\s.]+(px|pt|em|rem|%)?$/i],
        margin: [/^[\d\s.]+(px|pt|em|rem|%)?$/i],
      },
    },
    transformTags: {
      // Untrusted links must never share a browsing context with the admin app.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
      // Neuter remote images: keep the reference for an explicit opt-in, but do
      // not let the mere act of opening a ticket phone home to the sender.
      img: (tagName, attribs) => {
        const { src, ...rest } = attribs;
        return {
          tagName,
          attribs: src ? { ...rest, 'data-blocked-src': src } : rest,
        };
      },
    },
    // Drop the contents of these entirely rather than leaving orphaned text.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
  });
};

/**
 * Derive a readable plain-text body from an email payload.
 *
 * Prefers the provider's TextBody. Falls back to flattening the HTML — via the
 * sanitiser first, so tag-stripping never has to reason about hostile markup.
 *
 * @param {{ text?: string, html?: string }} bodies
 * @returns {string}
 */
export const derivePlainText = ({ text = '', html = '' } = {}) => {
  if (text && text.trim()) return text.trim();
  if (!html) return '';

  const safe = sanitizeEmailHtml(html);
  return safe
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // Decode the small set of entities that survive tag-stripping. `&amp;` is
    // decoded LAST so "&amp;lt;" cannot round-trip into a live "<".
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
};

/** Case-insensitive header lookup over Postmark's `Headers: [{Name, Value}]`. */
export const findHeader = (headers = [], name) => {
  const target = String(name).toLowerCase();
  const hit = (headers || []).find((h) => String(h?.Name || '').toLowerCase() === target);
  return hit ? String(hit.Value || '') : '';
};

/**
 * Is this inbound message machine-generated?
 *
 * This is the load-bearing check for loop prevention. An auto-reply must not
 * count as a customer response, must not reopen a resolved ticket, and must
 * never itself be acknowledged — otherwise our acknowledgement triggers their
 * out-of-office, which we treat as a reply, which triggers another
 * acknowledgement, and the pair mail each other until someone notices.
 *
 * @param {{ headers?: Array, from?: string, subject?: string }} input
 * @returns {boolean}
 */
export const isAutoReply = ({ headers = [], from = '', subject = '' } = {}) => {
  // RFC 3834: the standard, explicit signal.
  const autoSubmitted = findHeader(headers, 'Auto-Submitted').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;

  const precedence = findHeader(headers, 'Precedence').toLowerCase();
  if (['bulk', 'auto_reply', 'list', 'junk'].includes(precedence)) return true;

  // Vendor-specific markers used by Exchange, Zimbra and most autoresponders.
  for (const h of ['X-Autoreply', 'X-Autorespond', 'X-Auto-Response-Suppress', 'X-Mailer-Daemon']) {
    if (findHeader(headers, h)) return true;
  }
  if (findHeader(headers, 'X-Failed-Recipients')) return true;

  // Bounce and no-reply senders.
  const sender = String(from || '').toLowerCase();
  if (/(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce[s]?@)/.test(sender)) return true;

  // Subject-line conventions, as a last resort.
  const subj = String(subject || '').trim();
  if (/^\s*(out of (the )?office|auto(matic)?[ -]?(reply|response)|automatic reply|away from|on vacation|undeliverable|delivery status notification|mail delivery failed)/i.test(subj)) {
    return true;
  }

  return false;
};

export default {
  REPLY_SENTINEL,
  stripQuotedText,
  sanitizeEmailHtml,
  derivePlainText,
  findHeader,
  isAutoReply,
};
