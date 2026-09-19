/**
 * cleanHTML is the XSS control for product descriptions, review bodies and Q&A.
 *
 * ⚠ IT IS NOW THE ONLY ONE ON PUBLIC PAGES. The storefront's CSP used to be a
 * strict nonce policy, so an injected <script> could not execute even if it
 * reached the HTML. Statically rendered pages cannot carry a per-request nonce,
 * so their policy allows 'unsafe-inline' (see Front-end/web/src/lib/csp.ts
 * buildPublicCsp) — which means a sanitizer bypass is no longer contained by a
 * second layer. These cases exist so that change is not silently load-bearing
 * on an untested function.
 *
 * Note sanitize-html is PINNED at 2.17.5 (2.17.6+ breaks Jest), so this suite is
 * also the guard for the day that pin moves.
 */

import { cleanHTML } from '../../../utils/htmlSanitizer.js';

describe('cleanHTML strips executable content', () => {
  it.each([
    ['inline script', '<p>ok</p><script>alert(1)</script>'],
    ['script with attributes', '<script type="text/javascript" src="//evil.com/x.js"></script>'],
    ['iframe', '<iframe src="https://evil.com"></iframe>'],
    ['object', '<object data="evil.swf"></object>'],
    ['embed', '<embed src="evil.swf">'],
    ['style block', '<style>body{background:url(javascript:alert(1))}</style>'],
    ['svg with onload', '<svg onload="alert(1)"></svg>'],
    ['img with onerror', '<img src=x onerror="alert(1)">'],
    ['body onload', '<body onload="alert(1)">hi</body>'],
  ])('removes %s', (_label, dirty) => {
    const clean = cleanHTML(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/<iframe/i);
    expect(clean).not.toMatch(/<object/i);
    expect(clean).not.toMatch(/<embed/i);
    expect(clean).not.toMatch(/<svg/i);
    expect(clean).not.toMatch(/\son\w+\s*=/i);
    expect(clean).not.toMatch(/alert\(1\)/);
  });

  it('strips every on* handler, not just the well-known ones', () => {
    const clean = cleanHTML('<p onmouseover="steal()" onfocus="x()" ONCLICK="y()">t</p>');
    expect(clean).not.toMatch(/\son\w+\s*=/i);
    expect(clean).toContain('t');
  });

  it('drops javascript: and data: URLs on links', () => {
    // allowedSchemes is http/https/mailto, so these must not survive.
    for (const href of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox']) {
      expect(cleanHTML(`<a href="${href}">x</a>`)).not.toContain(href);
    }
  });

  it('blocks protocol-relative URLs — //evil.com is not a relative path', () => {
    // allowProtocolRelative:false. A naive "starts with /" check treats
    // //evil.com as same-origin; browsers treat it as an absolute cross-origin.
    expect(cleanHTML('<a href="//evil.com">x</a>')).not.toContain('//evil.com');
  });
});

describe('cleanHTML keeps the formatting the feature needs', () => {
  it('preserves the allowed inline tags', () => {
    const clean = cleanHTML('<p><strong>Bold</strong> and <em>italic</em><br><ul><li>one</li></ul></p>');
    for (const tag of ['<strong>', '<em>', '<br', '<ul>', '<li>']) expect(clean).toContain(tag);
  });

  it('keeps http(s) links and forces rel=noopener noreferrer', () => {
    // transformTags stamps rel on every anchor — reverse-tabnabbing protection
    // that must survive, since target=_blank is allowed.
    const clean = cleanHTML('<a href="https://example.com" target="_blank">x</a>');
    expect(clean).toContain('https://example.com');
    expect(clean).toContain('rel="noopener noreferrer"');
  });
});

describe('cleanHTML input handling', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['a number', 42],
  ])('passes %s through untouched rather than throwing', (_label, value) => {
    expect(cleanHTML(value)).toBe(value);
  });

  it('does not reintroduce content by double-unescaping', () => {
    // An already-escaped payload must stay inert, not be decoded back into a tag.
    expect(cleanHTML('&lt;script&gt;alert(1)&lt;/script&gt;')).not.toMatch(/<script/i);
  });
});
