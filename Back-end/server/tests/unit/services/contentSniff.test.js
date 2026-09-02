/**
 * Unit tests — services/storage/contentSniff.js
 *
 * This replaces a control we are losing. Cloudinary decoded every careers
 * upload and reported what it actually was; R2 stores bytes and does not even
 * enforce the Content-Type its own presigned PUT was signed with. Without this,
 * moving careers to R2 would turn a real format check into a header the client
 * picks.
 *
 * The tests are weighted toward REJECTION, because that is the direction that
 * fails silently: a legitimate video wrongly rejected is a loud, reported bug,
 * while HTML wrongly accepted into a CV slot is invisible until it matters.
 */
import { detectKind, matchesSlot, KIND } from '../../../services/storage/contentSniff.js';

const B = (...b) => Buffer.from(b);
const S = (s) => Buffer.from(s, 'latin1');
/** An ISO base-media header with the given 4-char brand. */
const ftyp = (brand) => Buffer.concat([B(0, 0, 0, 0x20), S('ftyp'), S(brand)]);

describe('documents', () => {
  test('detects PDF', () => {
    expect(detectKind(S('%PDF-1.7\n%\xE2\xE3\xCF\xD3'))).toBe(KIND.PDF);
  });
});

describe('video containers', () => {
  test.each([
    ['mp4', ftyp('isom')],
    ['mp4 v2', ftyp('iso2')],
    ['mp42', ftyp('mp42')],
    ['QuickTime', ftyp('qt  ')],
    ['3gp', ftyp('3gp4')],
    ['M4V', ftyp('M4V ')],
    ['WebM/Matroska', Buffer.concat([B(0x1A, 0x45, 0xDF, 0xA3), S('....')])],
    ['Ogg', S('OggS\x00\x02\x00\x00')],
    ['AVI', Buffer.concat([S('RIFF'), B(0, 0, 0, 0), S('AVI ')])],
    ['MPEG-PS', B(0x00, 0x00, 0x01, 0xBA, 0, 0, 0, 0)],
    ['MPEG video', B(0x00, 0x00, 0x01, 0xB3, 0, 0, 0, 0)],
    ['ASF/WMV', B(0x30, 0x26, 0xB2, 0x75, 0, 0, 0, 0)],
  ])('detects %s as video', (_label, buf) => {
    expect(detectKind(buf)).toBe(KIND.VIDEO);
    expect(matchesSlot(buf, 'video')).toBe(true);
  });

  test('the container list is generous on purpose', () => {
    // A false reject costs a real applicant their submission, so anything that
    // looks like a known container is accepted rather than second-guessed.
    expect(detectKind(ftyp('mmp4'))).toBe(KIND.VIDEO);
    expect(detectKind(ftyp('avc1'))).toBe(KIND.VIDEO);
  });
});

describe('ISO base media: video vs image is decided by BRAND', () => {
  test.each(['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'])(
    'ftyp brand %s is an IMAGE, not a video', (brand) => {
      // MP4 and AVIF/HEIC share the `ftyp` box. Treating every ftyp as video
      // would file a still image as a video answer.
      expect(detectKind(ftyp(brand))).toBe(KIND.IMAGE);
      expect(matchesSlot(ftyp(brand), 'video')).toBe(false);
    });

  test('brand matching is case-insensitive', () => {
    expect(detectKind(ftyp('AVIF'))).toBe(KIND.IMAGE);
  });
});

describe('raster images', () => {
  test.each([
    ['JPEG', B(0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0)],
    ['PNG', B(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)],
    ['WebP', Buffer.concat([S('RIFF'), B(0, 0, 0, 0), S('WEBP')])],
    ['GIF', S('GIF89a\x00\x00')],
  ])('detects %s', (_label, buf) => {
    expect(detectKind(buf)).toBe(KIND.IMAGE);
    expect(matchesSlot(buf, 'image')).toBe(true);
  });
});

describe('REJECTION — the direction that fails silently', () => {
  test.each([
    ['HTML', S('<html><script>alert(1)</script></html>')],
    ['HTML with a leading BOM', Buffer.concat([B(0xEF, 0xBB, 0xBF), S('<html>')])],
    ['SVG (an image type that executes script)', S('<svg xmlns="http://www.w3.org/2000/svg">')],
    ['shell script', S('#!/bin/sh\nrm -rf /')],
    ['ELF executable', B(0x7F, 0x45, 0x4C, 0x46, 0, 0, 0, 0)],
    ['Windows PE', S('MZ\x90\x00\x03\x00\x00\x00')],
    ['ZIP / Office doc', B(0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0)],
    ['plain text', S('just some text, honestly')],
    ['JSON', S('{"not":"a video"}')],
  ])('%s is unrecognised and rejected by every slot', (_label, buf) => {
    expect(detectKind(buf)).toBeNull();
    expect(matchesSlot(buf, 'video')).toBe(false);
    expect(matchesSlot(buf, 'raw')).toBe(false);
    expect(matchesSlot(buf, 'image')).toBe(false);
  });

  test('a PDF cannot satisfy a video slot, nor a video a document slot', () => {
    const pdf = S('%PDF-1.4');
    const mp4 = ftyp('isom');
    expect(matchesSlot(pdf, 'video')).toBe(false);
    expect(matchesSlot(mp4, 'raw')).toBe(false);
  });

  test('an unknown slot name accepts nothing', () => {
    expect(matchesSlot(S('%PDF-1.4'), 'document')).toBe(false);
    expect(matchesSlot(S('%PDF-1.4'), undefined)).toBe(false);
  });
});

describe('unusable input fails closed', () => {
  test.each([
    ['empty', Buffer.alloc(0)],
    ['too short', B(0xFF, 0xD8)],
    ['not a buffer', 'ffd8ff'],
    ['null', null],
    ['undefined', undefined],
  ])('%s -> null, and matches no slot', (_label, buf) => {
    expect(detectKind(buf)).toBeNull();
    expect(matchesSlot(buf, 'video')).toBe(false);
    expect(matchesSlot(buf, 'raw')).toBe(false);
  });

  test('never throws, whatever it is handed', () => {
    [null, undefined, 42, {}, [], 'x', Buffer.alloc(1)].forEach((v) => {
      expect(() => detectKind(v)).not.toThrow();
      expect(() => matchesSlot(v, 'video')).not.toThrow();
    });
  });
});
