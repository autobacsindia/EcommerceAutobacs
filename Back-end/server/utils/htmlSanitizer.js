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
  sanitized = sanitized.replace(/<\/p>/gi, '\n');
  sanitized = sanitized.replace(/<p[^>]*>/gi, '');
  
  // Replace div tags with newlines
  sanitized = sanitized.replace(/<\/div>/gi, '\n');
  sanitized = sanitized.replace(/<div[^>]*>/gi, '');
  
  // Remove all other HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');
  
  // Trim extra whitespace
  sanitized = sanitized.replace(/\s+/g, '\n').trim();
  
  return sanitized;
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