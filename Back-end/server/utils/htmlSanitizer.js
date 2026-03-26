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