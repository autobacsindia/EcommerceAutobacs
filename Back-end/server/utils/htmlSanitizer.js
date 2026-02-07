import escapeHtml from 'escape-html';

function removeHtmlTags(html) {
  if (!html || typeof html !== 'string') {
    return html;
  }

  // Remove script and iframe tags completely (for security)
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  
  // Replace br tags with newlines
  sanitized = sanitized.replace(/<br\s*\/?>/gi, '\n');
  
  // Replace p tags with newlines
  sanitized = sanitized.replace(/<\/p>/gi, '\n\n');
  sanitized = sanitized.replace(/<p[^>]*>/gi, '');
  
  // Replace div tags with newlines
  sanitized = sanitized.replace(/<\/div>/gi, '\n\n');
  sanitized = sanitized.replace(/<div[^>]*>/gi, '');
  
  // Remove all other HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  // Replace multiple horizontal spaces with single space
  sanitized = sanitized.replace(/[ \t]+/g, ' ');

  // Collapse multiple newlines to max 2
  sanitized = sanitized.replace(/\n\s*\n/g, '\n\n');
  
  return sanitized.trim();
}

function sanitizeProductDescriptions(products) {
  return products.map(product => {
    if (product.description) {
      return {
        ...product,
        description: removeHtmlTags(product.description)
      };
    }
    return product;
  });
}

export { removeHtmlTags, sanitizeProductDescriptions };
export default { removeHtmlTags, sanitizeProductDescriptions };