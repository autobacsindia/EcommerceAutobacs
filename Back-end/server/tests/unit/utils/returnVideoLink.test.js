/**
 * The unboxing-video link (utils/returnVideoLink.js): the way in for a video too big to
 * upload. https only, exact allow-listed hostnames, nothing else.
 */
import { verifyVideoLink, VIDEO_LINK_MAX_LENGTH } from '../../../utils/returnVideoLink.js';

describe('verifyVideoLink', () => {
  it('no link at all is null (the upload may carry the video)', () => {
    expect(verifyVideoLink(undefined)).toBeNull();
    expect(verifyVideoLink(null)).toBeNull();
    expect(verifyVideoLink('   ')).toBeNull();
  });

  it.each([
    'https://drive.google.com/file/d/1AbC/view?usp=sharing',
    'https://photos.google.com/share/xyz',
    'https://photos.app.goo.gl/abc',
    'https://youtube.com/shorts/abc',
    'https://www.youtube.com/watch?v=abc',
    'https://m.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
    'https://DRIVE.GOOGLE.COM/file/d/x',
  ])('accepts %s', (link) => {
    expect(verifyVideoLink(` ${link} `)).toBe(new URL(link).href);
  });

  it.each([
    ['plain http', 'http://drive.google.com/file/d/x'],
    ['a look-alike host', 'https://drive.google.com.evil.example/x'],
    ['a sub-domain of an allowed host', 'https://evil.youtu.be/x'],
    ['another video host', 'https://vimeo.com/123'],
    ['credentials in the link', 'https://user:pw@drive.google.com/x'],
    ['a script', 'javascript:alert(1)'],
    ['not a link', 'my video'],
    ['not a string', { href: 'https://youtu.be/x' }],
  ])('rejects %s with a 400 the customer can read', (_why, link) => {
    expect(() => verifyVideoLink(link)).toThrow(expect.objectContaining({ statusCode: 400, expose: true }));
  });

  it('rejects a link longer than the stored field', () => {
    const long = `https://youtu.be/${'a'.repeat(VIDEO_LINK_MAX_LENGTH)}`;
    expect(() => verifyVideoLink(long)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});
