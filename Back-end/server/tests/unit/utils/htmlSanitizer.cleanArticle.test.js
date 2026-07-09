/**
 * Unit tests for cleanArticleHTML — the server-side blog-body sanitizer that lets
 * the frontend render article content in SSR (FE-3). Verifies it keeps legitimate
 * article markup (headings, images, blockquotes) but strips scripts/handlers and
 * unwraps legacy WordPress image links.
 */

import { cleanArticleHTML } from '../../../utils/htmlSanitizer.js';

describe('cleanArticleHTML', () => {
  it('keeps legitimate article markup (headings, images, blockquotes, links)', () => {
    const html =
      '<h2>Title</h2><p>Body <strong>bold</strong></p>' +
      '<img src="https://cdn.example/a.jpg" alt="a">' +
      '<blockquote>quote</blockquote><a href="https://x.com">link</a>';
    const out = cleanArticleHTML(html);
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<img');
    expect(out).toContain('alt="a"');
    expect(out).toContain('<blockquote>quote</blockquote>');
    expect(out).toContain('rel="noopener noreferrer"'); // link hardening
  });

  it('strips <script>, <iframe> and inline event handlers (XSS)', () => {
    const html = '<p onclick="steal()">hi</p><script>alert(1)</script><iframe src="evil"></iframe>';
    const out = cleanArticleHTML(html);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('hi');
  });

  it('unwraps WordPress <a href=".../wp-content/...">-wrapped images', () => {
    const html =
      '<a href="https://autobacsindia.com/wp-content/uploads/x.jpg"><img src="https://cdn/x.jpg" alt="x"></a>';
    const out = cleanArticleHTML(html);
    expect(out).toContain('<img');
    expect(out).not.toMatch(/wp-content/);
    expect(out).not.toMatch(/<a\b/); // the wrapping anchor is gone
  });

  it('returns non-string input untouched', () => {
    expect(cleanArticleHTML(null)).toBeNull();
    expect(cleanArticleHTML(undefined)).toBeUndefined();
  });
});
