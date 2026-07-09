import sanitizeHtml from 'sanitize-html';

/**
 * cleanHTML - strips unsafe HTML from rich user-supplied content.
 * Use for: product descriptions, review titles/comments, Q&A questions/answers.
 * Do NOT use for plain-text fields (name, city, etc.) - trim those instead.
 */
export function cleanHTML(dirty) {
  if (!dirty || typeof dirty !== 'string') return dirty;
  return sanitizeHtml(dirty, {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'ul', 'ol', 'li', 'br'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false, // Block //evil.com protocol-relative URLs
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer' },
      }),
    },
  });
}

/**
 * cleanArticleHTML - sanitize blog/article body HTML for safe rendering.
 * More permissive than cleanHTML (articles legitimately use headings, images,
 * blockquotes, tables, figures) but still strips <script>/<iframe>, event handlers
 * (on*), and unknown tags. Also unwraps WordPress `<a href=".../wp-content/...">`
 * image links (legacy import artifact). Running this server-side lets the frontend
 * render the body in SSR (SEO) instead of sanitizing client-side after mount. (FE-3)
 */
export function cleanArticleHTML(dirty) {
  if (!dirty || typeof dirty !== 'string') return dirty;
  // Unwrap WP image links first: <a href="…wp-content…"><img …></a> → <img …>
  const unwrapped = dirty.replace(
    /<a\b[^>]*\bhref="https?:\/\/[^"]*\/wp-content\/[^"]*"[^>]*>\s*(<img\b[^>]*\/?>)\s*<\/a>/gi,
    '$1',
  );
  return sanitizeHtml(unwrapped, {
    allowedTags: [
      'p', 'br', 'hr', 'span', 'div',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup',
      'a', 'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      '*': ['class', 'id'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener noreferrer' } }),
    },
  });
}

function removeHtmlTags(html) {
  if (!html || typeof html !== 'string') { return html; }
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  sanitized = sanitized.replace(/<br\s*\/?>/gi, '\n');
  sanitized = sanitized.replace(/<\/p>/gi, '\n\n');
  sanitized = sanitized.replace(/<p[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\/div>/gi, '\n\n');
  sanitized = sanitized.replace(/<div[^>]*>/gi, '');
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  sanitized = sanitized.replace(/[ \t]+/g, ' ');
  sanitized = sanitized.replace(/\n\s*\n/g, '\n\n');
  return sanitized.trim();
}

function sanitizeProductDescriptions(products) {
  return products.map(product => {
    if (product.description) { return { ...product, description: removeHtmlTags(product.description) }; }
    return product;
  });
}

export { removeHtmlTags, sanitizeProductDescriptions };
export default { removeHtmlTags, sanitizeProductDescriptions };