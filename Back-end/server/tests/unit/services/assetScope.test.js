/**
 * Unit tests — services/storage/assetScope.js
 *
 * These guard a one-way mistake. Routing a product photo to the private bucket
 * makes an image fail to load; routing an applicant's CV or a customer's return
 * video to the PUBLIC bucket publishes it to a world-readable CDN domain and
 * cannot be undone by deleting the object later.
 *
 * So the assertions are deliberately paranoid about the private direction and
 * about the fail-closed default.
 */
import {
  scopeFor, PRIVATE_PREFIXES, PUBLIC_ROOT_IDS, KNOWN_ORPHANS,
} from '../../../services/storage/assetScope.js';

describe('private assets', () => {
  test.each([
    'autobacs/careers/n0nce/answer1',
    'autobacs/careers/n0nce/resume.pdf',
    'autobacs/returns/req123/unboxing',
    'autobacs/support/TKT-1/attachment.pdf',
    'shipping-slips/slip-AB12.pdf',
    'invoices/INV-0001.pdf',
  ])('%s → private', (id) => {
    expect(scopeFor(id)).toBe('private');
  });

  test('every declared private prefix resolves private at its own root', () => {
    PRIVATE_PREFIXES.forEach((p) => expect(scopeFor(p)).toBe('private'));
  });

  test('a private path is never shadowed by a root public prefix', () => {
    // `kling_` is a public ROOT prefix; nested under careers it must stay private.
    expect(scopeFor('autobacs/careers/kling_applicant_video')).toBe('private');
  });
});

describe('public assets', () => {
  test.each([
    'autobacs/products/abc123',
    'autobacs/brands/logo',
    'autobacs/categories/tyres',
    'autobacs/vehicle and makes/thar',
    'autobacs/promo-banners/diwali',
    'autobacs/spin-prizes/tshirt',
    'autobacs/media/press1',
    'autobacs/site/hero-performance-vehicle',
    'press-coverage/article1',
  ])('%s → public', (id) => {
    expect(scopeFor(id)).toBe('public');
  });

  test.each([
    // Derived from the 2026-09-01 production reference audit, not guessed.
    'kia_sonet_ww17n9',
    'mahindra_scorpio_gqqybu',
    'roavion-primary_pwywsn',
    'before_bmw_hlwaqs',
    'after_bmw_svmikn',
    // The three ids that a prefix-based rule got wrong:
    'marutii_jimmy_lnlj5k',        // typo in the source data ("marutii")
    'ford_-ranger_sofijq',         // inconsistent separator ("ford_-")
    'toyota_innova_hycross_fsujya',
  ])('root-level artwork %s → public', (id) => {
    expect(scopeFor(id)).toBe('public');
  });

  test('every id in the audited root allowlist resolves public', () => {
    PUBLIC_ROOT_IDS.forEach((id) => expect(scopeFor(id)).toBe('public'));
  });
});

describe('fail-closed default', () => {
  test.each([
    'autobacs/some-new-folder/asset',
    'totally/unknown/path',
    'unmapped-root-asset',
    'autobacs',
  ])('unrecognised %s → null (skip and report, never a default)', (id) => {
    expect(scopeFor(id)).toBeNull();
  });

  test('Cloudinary demo content is excluded', () => {
    expect(scopeFor('samples/landscapes/landscape-panorama')).toBeNull();
    expect(scopeFor('samples/breakfast')).toBeNull();
    expect(scopeFor('cld-sample-3')).toBeNull();
    expect(scopeFor('main-sample')).toBeNull();
  });

  test('`sample` is excluded — it was a substring false positive, not a real reference', () => {
    // A loose scan reported it as used because an article contains "sampled".
    expect(scopeFor('sample')).toBeNull();
  });

  test('every audited orphan resolves null', () => {
    KNOWN_ORPHANS.forEach((id) => expect(scopeFor(id)).toBeNull());
  });

  test('the unreferenced brand-logos folder is not migrated', () => {
    // Looks real, appears in no Cloudinary folder listing, referenced nowhere.
    // Live brand logos are in autobacs/brands.
    expect(scopeFor('autobacs/brand-logos/ironman')).toBeNull();
    expect(scopeFor('autobacs/brand-logos/profender-logo-1')).toBeNull();
  });

  test('the audited sets are disjoint', () => {
    PUBLIC_ROOT_IDS.forEach((id) => expect(KNOWN_ORPHANS.has(id)).toBe(false));
  });

  test.each([undefined, null, '', '   ', 42, {}])('unusable input %p → null', (id) => {
    expect(scopeFor(id)).toBeNull();
  });
});

describe('prefix matching is segment-aware', () => {
  test('a folder that merely starts with a public prefix does not match', () => {
    // `autobacs/products-archive` is NOT `autobacs/products`.
    expect(scopeFor('autobacs/products-archive/x')).toBeNull();
  });

  test('a folder that merely starts with a private prefix does not match either', () => {
    expect(scopeFor('autobacs/careers-public/x')).toBeNull();
  });

  test('tolerates a leading slash', () => {
    expect(scopeFor('/autobacs/products/abc')).toBe('public');
    expect(scopeFor('/autobacs/careers/n/cv.pdf')).toBe('private');
  });
});
