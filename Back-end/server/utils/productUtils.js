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
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  return sanitized;
}

function truncateString(str, maxLength) {
  if (!str || typeof str !== 'string') {
    return str;
  }
  
  if (str.length <= maxLength) {
    return str;
  }
  
  return str.substring(0, maxLength);
}

export { removeHtmlTags, truncateString };
export default { removeHtmlTags, truncateString };