import { cleanRichText, cleanRichTextWithin, isRichText, richTextToPlain, richTextLength } from '../utils/richText.js';

describe('richText — telling plain from formatted', () => {
  test('old plain values are plain, even with angle brackets', () => {
    expect(isRichText('Call the customer at 5pm')).toBe(false);
    expect(isRichText('price < 500 and > 200')).toBe(false);
    expect(isRichText('<b>bold</b> typed by hand')).toBe(false);
    expect(isRichText('')).toBe(false);
    expect(isRichText(null)).toBe(false);
  });
  test('editor output is formatted', () => {
    expect(isRichText('<p>Hi</p>')).toBe(true);
    expect(isRichText('<ul><li><p>a</p></li></ul>')).toBe(true);
    expect(isRichText('  <h2>Title</h2>')).toBe(true);
    expect(isRichText('<blockquote><p>q</p></blockquote>')).toBe(true);
  });
});

describe('cleanRichText — stored safely', () => {
  test('plain text is kept exactly (trimmed), never parsed', () => {
    expect(cleanRichText('  <script>alert(1)</script> old note  ')).toBe('<script>alert(1)</script> old note');
    expect(cleanRichText(undefined)).toBe('');
  });

  test.each([
    ['<p>hi<script>alert(1)</script></p>', '<p>hi</p>'],
    ['<p><img src=x onerror=alert(1)>hi</p>', '<p>hi</p>'],
    ['<p onclick="alert(1)">hi</p>', '<p>hi</p>'],
    ['<p><a href="javascript:alert(1)">x</a></p>', '<p><a target="_blank" rel="noopener noreferrer nofollow">x</a></p>'],
    ['<p><a href="//evil.com">x</a></p>', '<p><a target="_blank" rel="noopener noreferrer nofollow">x</a></p>'],
    ['<p><iframe src="https://evil.com"></iframe>ok</p>', '<p>ok</p>'],
    ['<p style="color:red" class="x">ok</p>', '<p>ok</p>'],
    ['<p><svg onload=alert(1)>ok</svg></p>', '<p>ok</p>'],
  ])('strips %s', (dirty, clean) => {
    expect(cleanRichText(dirty)).toBe(clean);
  });

  test('keeps every format the box can make', () => {
    const html = '<h2>Plan</h2><h3>Sub</h3><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code> '
      + '<a href="https://autobacsindia.com" target="_blank" rel="noopener noreferrer nofollow">link</a></p>'
      + '<ul><li><p>one</p></li></ul><ol start="3"><li><p>three</p></li></ol><blockquote><p>q</p></blockquote>'
      + '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked" /><span></span></label><div><p>done</p></div></li></ul>';
    const clean = cleanRichText(html);
    for (const bit of ['<h2>', '<h3>', '<strong>', '<em>', '<u>', '<s>', '<code>', 'href="https://autobacsindia.com"',
      '<ol start="3">', '<blockquote>', 'data-type="taskList"', 'data-checked="true"', 'type="checkbox"']) {
      expect(clean).toContain(bit);
    }
  });

  test('links always open in a new tab safely, whatever was sent', () => {
    expect(cleanRichText('<p><a href="https://x.com" target="_self" rel="opener">x</a></p>'))
      .toBe('<p><a href="https://x.com" target="_blank" rel="noopener noreferrer nofollow">x</a></p>');
  });

  test('pasted Word/Docs headings and wrappers are folded into what the box offers', () => {
    expect(cleanRichText('<h1>Big</h1>')).toBe('<h2>Big</h2>');
    expect(cleanRichText('<p><span style="font-family:Calibri" class="MsoNormal">Word</span></p>')).toBe('<p><span>Word</span></p>');
  });

  test('checklist attributes accept only the editor values', () => {
    const c = cleanRichText('<ul data-type="evil"><li data-type="taskItem" data-checked="yes"><p>x</p></li></ul>');
    expect(c).toBe('<ul><li data-type="taskItem" data-checked="false"><p>x</p></li></ul>');
    expect(cleanRichText('<p><input type="text" value="x" checked>a</p>')).toBe('<p><input type="checkbox" checked="checked" />a</p>');
  });

  test('trailing empty lines are dropped, inner ones kept', () => {
    expect(cleanRichText('<p>a</p><p></p><p>b</p><p></p><p><br></p>')).toBe('<p>a</p><p></p><p>b</p>');
  });

  test('empty formatting becomes empty', () => {
    expect(cleanRichText('<p></p>')).toBe('');
    expect(cleanRichText('<p>&nbsp; <br></p>')).toBe('');
    expect(cleanRichText('<p><script>x</script></p>')).toBe('');
  });

  test('cleaning twice changes nothing (stable for edit checks)', () => {
    const once = cleanRichText('<p>a <strong>b</strong> <a href="https://x.com">c</a></p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>d</p></div></li></ul>');
    expect(cleanRichText(once)).toBe(once);
  });
});

describe('richTextToPlain — emails, pop-ups, exports', () => {
  test('plain stays plain', () => {
    expect(richTextToPlain('line one\nline two')).toBe('line one\nline two');
    expect(richTextToPlain(null)).toBe('');
  });

  test('reads cleanly with list markers and links', () => {
    const html = '<h2>Steps</h2><p>Call <strong>Ravi</strong> &amp; check</p>'
      + '<ul><li><p>pack</p></li><li><p>ship</p></li></ul>'
      + '<ol start="2"><li><p>two</p></li><li><p>three</p></li></ol>'
      + '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>paid</p></div></li>'
      + '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>sent</p></div></li></ul>'
      + '<p><a href="https://x.com/o/1">the order</a> and <a href="https://x.com">https://x.com</a></p>';
    expect(richTextToPlain(html)).toBe([
      'Steps', 'Call Ravi & check', '', '• pack', '• ship', '', '2. two', '3. three', '', '[x] paid', '[ ] sent', '',
      'the order (https://x.com/o/1) and https://x.com',
    ].join('\n').replace(/\n\n\n+/g, '\n\n'));
  });

  test('length counts words, not markup', () => {
    expect(richTextLength('<p><strong>abc</strong></p>')).toBe(3);
    expect(richTextLength('abc')).toBe(3);
  });
});

describe('cleanRichTextWithin — one call for services', () => {
  test('cleans and reports length in words', () => {
    expect(cleanRichTextWithin('<p><strong>abc</strong><script>x</script></p>', 3)).toEqual({ value: '<p><strong>abc</strong></p>', tooLong: false });
    expect(cleanRichTextWithin('<p>abcd</p>', 3).tooLong).toBe(true);
    expect(cleanRichTextWithin('  plain  ', 10)).toEqual({ value: 'plain', tooLong: false });
    expect(cleanRichTextWithin(null, 10)).toEqual({ value: '', tooLong: false });
  });
  test('a payload far over the limit is refused without parsing', () => {
    expect(cleanRichTextWithin(`<p>${'<b></b>'.repeat(400)}</p>`, 10)).toEqual({ value: '', tooLong: true });
  });
});
