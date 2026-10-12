/**
 * scripts/rewrite-asset-urls.js — Cloudinary URL → R2 key matching.
 *
 * THE BUG THIS GUARDS
 * --------------------
 * A Cloudinary delivery URL is percent-encoded; an R2 object key is not. One
 * folder in this account has spaces in its name (`autobacs/vehicle and makes`),
 * so every URL for it carries `%20` while the stored key carries a real space.
 * The matcher compared the two literally, found nothing, and reported the asset
 * as "no R2 object" — a SILENT skip, not an error.
 *
 * The first production dry run showed the cost exactly: 1 document to change,
 * when five images were visibly still served from Cloudinary. The four vehicle
 * photos were being skipped on encoding alone, and would have been the images
 * left pointing at a closed Cloudinary account.
 *
 * The matcher must stay conservative in the other direction too: returning ''
 * is what makes the script leave a document alone, so a guess that happens to
 * name an object we do not hold would swap a working link for a 404.
 */

import { publicIdFromUrl, r2KeyForUrl } from '../scripts/rewrite-asset-urls.js';

const CLD = 'https://res.cloudinary.com/dhwxtl6l8/image/upload';

describe('publicIdFromUrl', () => {
  test('strips host, version and transformation segment', () => {
    expect(publicIdFromUrl(`${CLD}/v1781334527/autobacs/products/abc/img-0.jpg`))
      .toBe('autobacs/products/abc/img-0.jpg');
    expect(publicIdFromUrl(`${CLD}/f_auto,q_auto,w_500,c_limit/v1/autobacs/products/abc/img-0.jpg`))
      .toBe('autobacs/products/abc/img-0.jpg');
  });

  test('a non-delivery URL yields nothing', () => {
    expect(publicIdFromUrl('https://example.com/a.jpg')).toBe('');
  });
});

describe('r2KeyForUrl — percent-encoded folder names', () => {
  const SPACED = 'autobacs/vehicle and makes/hrt6dvxvin5jr3nx8pmw.jpg';

  test('%20 in the URL matches a key stored with a real space', () => {
    const present = new Set([SPACED]);
    const url = `${CLD}/v1789535725/autobacs/vehicle%20and%20makes/hrt6dvxvin5jr3nx8pmw.jpg`;
    expect(r2KeyForUrl(url, present)).toBe(SPACED);
  });

  test('an unencoded URL for the same object still matches', () => {
    const present = new Set([SPACED]);
    const url = `${CLD}/v1789535725/autobacs/vehicle and makes/hrt6dvxvin5jr3nx8pmw.jpg`;
    expect(r2KeyForUrl(url, present)).toBe(SPACED);
  });

  test('a transformed URL of a spaced key matches', () => {
    const present = new Set([SPACED]);
    const url = `${CLD}/f_auto,q_auto/v1789535725/autobacs/vehicle%20and%20makes/hrt6dvxvin5jr3nx8pmw.jpg`;
    expect(r2KeyForUrl(url, present)).toBe(SPACED);
  });

  test('still returns nothing when the object is genuinely absent', () => {
    const url = `${CLD}/v1789535725/autobacs/vehicle%20and%20makes/not-copied.jpg`;
    expect(r2KeyForUrl(url, new Set([SPACED]))).toBe('');
  });

  test('a malformed escape does not throw — it falls back to the raw form', () => {
    const key = 'autobacs/products/100%-cotton.jpg';
    const url = `${CLD}/v1/${key}`;
    expect(() => r2KeyForUrl(url, new Set())).not.toThrow();
    expect(r2KeyForUrl(url, new Set([key]))).toBe(key);
  });
});

describe('r2KeyForUrl — extension handling (unchanged behaviour)', () => {
  test('an image public_id carries no extension, the object does', () => {
    const present = new Set(['autobacs/brands/jbtql725xbgxzem1uynf.png']);
    const url = `${CLD}/v1789811104/autobacs/brands/jbtql725xbgxzem1uynf.png`;
    expect(r2KeyForUrl(url, present)).toBe('autobacs/brands/jbtql725xbgxzem1uynf.png');
  });

  test('matches when the stored object gained an extension the URL lacks', () => {
    const present = new Set(['autobacs/brands/logo.png']);
    expect(r2KeyForUrl(`${CLD}/v1/autobacs/brands/logo`, present)).toBe('autobacs/brands/logo.png');
  });

  test('no object, no rewrite', () => {
    expect(r2KeyForUrl(`${CLD}/v1/autobacs/products/ghost.jpg`, new Set())).toBe('');
  });
});
