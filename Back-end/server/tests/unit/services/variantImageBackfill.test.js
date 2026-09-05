/**
 * Unit tests — services/variantImageBackfill.js
 *
 * This is a one-shot recovery of 389 photographs that exist nowhere but an old
 * WordPress host. It gets one clean attempt against production data, so the
 * decisions it makes are pinned here rather than discovered during the run:
 *
 *   • it must be re-runnable without duplicating work or re-uploading bytes
 *   • it must never overwrite a photo an admin has since set
 *   • it must never disturb the existing gallery order or the primary image
 *   • a shared source image must cost one upload, not one per model
 */
import {
  basenameFor,
  extensionOf,
  keyFor,
  planProductBackfill,
  composeProductUpdate,
  summarise,
  matchByLabel,
  normaliseLabel,
  SKIP,
} from '../../../services/variantImageBackfill.js';

const WP = 'https://autobacsindia.com/wp-content/uploads/2025/05';
const R2 = 'https://img.autobacsindia.com';

const img = (id, extra = {}) => ({
  url: `${R2}/${id}`, public_id: id, alt: 'x', isPrimary: false, variantOwned: false, ...extra,
});

const product = ({ images = [], variants = [] } = {}) => ({
  _id: 'p1', name: 'Tail Lights', slug: 'tail-lights', images, variants,
});

const wcVar = (id, src) => ({ id, ...(src && { image: { id: 1, src } }) });

describe('basenameFor / extensionOf / keyFor', () => {
  test('the same source URL always yields the same basename', () => {
    expect(basenameFor(`${WP}/a.jpg`)).toBe(basenameFor(`${WP}/a.jpg`));
  });

  test('different sources yield different basenames', () => {
    expect(basenameFor(`${WP}/a.jpg`)).not.toBe(basenameFor(`${WP}/b.jpg`));
  });

  test('extension is read from the path, ignoring a query string', () => {
    expect(extensionOf(`${WP}/a.JPG?ver=2`)).toBe('jpg');
    expect(extensionOf(`${WP}/a.webp`)).toBe('webp');
  });

  test('a URL with no extension yields none rather than guessing', () => {
    expect(extensionOf(`${WP}/noext`)).toBe('');
    expect(extensionOf('not a url')).toBe('');
  });

  test('the key mirrors the admin uploader shape, scoped to the product', () => {
    expect(keyFor('p1', `${WP}/a.jpg`)).toMatch(/^autobacs\/products\/p1\/v-[0-9a-f]{16}\.jpg$/);
  });

  test('an unsupported format produces no key at all', () => {
    expect(keyFor('p1', `${WP}/a.svg`)).toBe('');
    expect(keyFor('p1', `${WP}/a.gif`)).toBe('');
  });

  test('AVIF is re-hosted — six live Woo variation images are .avif', () => {
    // Dropping these as "unsupported" on a pipeline that generates AVIF
    // derivatives would have silently lost six recoverable photos.
    expect(keyFor('p1', `${WP}/a.avif`)).toMatch(/\.avif$/);
  });
});

describe('planProductBackfill', () => {
  test('plans one upload per model that needs a photo', () => {
    const plan = planProductBackfill(
      product({
        images: [img('pack', { isPrimary: true })],
        variants: [
          { _id: 'v1', label: 'smoked', wpVariationId: 11 },
          { _id: 'v2', label: 'clear', wpVariationId: 22 },
        ],
      }),
      [wcVar(11, `${WP}/smoked.jpg`), wcVar(22, `${WP}/clear.jpg`)],
    );

    expect(plan.uploads).toHaveLength(2);
    expect(plan.uploads.map((u) => u.variantIds)).toEqual([['v1'], ['v2']]);
    expect(plan.skipped).toHaveLength(0);
  });

  test('DEDUPES a source shared by several models into ONE upload', () => {
    const plan = planProductBackfill(
      product({
        variants: [
          { _id: 'v1', label: 'a', wpVariationId: 11 },
          { _id: 'v2', label: 'b', wpVariationId: 22 },
        ],
      }),
      [wcVar(11, `${WP}/same.jpg`), wcVar(22, `${WP}/same.jpg`)],
    );

    expect(plan.uploads).toHaveLength(1);
    expect(plan.uploads[0].variantIds).toEqual(['v1', 'v2']);
  });

  test('IDEMPOTENT — a model that already has a photo is skipped', () => {
    const plan = planProductBackfill(
      product({ variants: [{ _id: 'v1', label: 'a', wpVariationId: 11, imageKey: 'anything' }] }),
      [wcVar(11, `${WP}/a.jpg`)],
    );

    expect(plan.uploads).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe(SKIP.ALREADY);
  });

  test("never clobbers a photo the ADMIN set since migration", () => {
    // The admin replaced the Woo original with a better shot. The Woo source is
    // still there and still matches, but the pointer wins.
    const plan = planProductBackfill(
      product({
        images: [img('autobacs/products/p1/admin-choice.jpg')],
        variants: [{ _id: 'v1', wpVariationId: 11, imageKey: 'autobacs/products/p1/admin-choice.jpg' }],
      }),
      [wcVar(11, `${WP}/woo-original.jpg`)],
    );
    expect(plan.uploads).toHaveLength(0);
  });

  test('REUSES an asset already in the gallery instead of re-uploading', () => {
    // The shape after a crash between upload and DB write: bytes are in the
    // bucket and the row exists, but no model points at it yet.
    const key = keyFor('p1', `${WP}/smoked.jpg`);
    const plan = planProductBackfill(
      product({
        images: [img('pack', { isPrimary: true }), img(key, { variantOwned: true })],
        variants: [{ _id: 'v1', wpVariationId: 11 }],
      }),
      [wcVar(11, `${WP}/smoked.jpg`)],
    );

    expect(plan.uploads).toHaveLength(1);
    expect(plan.uploads[0].reuseExisting).toBe(true);
    expect(plan.uploads[0].publicId).toBe(key);
  });

  test('matches a reused asset even if its stored extension differs', () => {
    const base = basenameFor(`${WP}/smoked.jpg`);
    const plan = planProductBackfill(
      product({
        images: [img(`autobacs/products/p1/${base}.webp`)],
        variants: [{ _id: 'v1', wpVariationId: 11 }],
      }),
      [wcVar(11, `${WP}/smoked.jpg`)],
    );
    expect(plan.uploads[0].reuseExisting).toBe(true);
  });

  test('records why each model produced no work', () => {
    const plan = planProductBackfill(
      product({
        variants: [
          { _id: 'v1', label: 'no woo row', wpVariationId: 99 },
          { _id: 'v2', label: 'woo row has no image', wpVariationId: 11 },
          { _id: 'v3', label: 'not a supported format', wpVariationId: 22 },
          { _id: 'v4', label: 'never came from woo' },
        ],
      }),
      [wcVar(11), wcVar(22, `${WP}/a.svg`)],
    );

    expect(plan.uploads).toHaveLength(0);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      SKIP.UNMATCHED, SKIP.NO_SOURCE, SKIP.UNSUPPORTED, SKIP.UNMATCHED,
    ]);
  });

  test('a simple product with no models plans nothing', () => {
    expect(planProductBackfill(product(), []).uploads).toHaveLength(0);
  });
});

describe('composeProductUpdate', () => {
  const uploadedRef = (key) => ({ url: `${R2}/${key}`, public_id: key });

  test('appends the photo and points the model at it', () => {
    const p = product({
      images: [img('pack', { isPrimary: true })],
      variants: [{ _id: 'v1', label: 'smoked', wpVariationId: 11 }],
    });
    const plan = planProductBackfill(p, [wcVar(11, `${WP}/smoked.jpg`)]);
    const key = plan.uploads[0].key;

    const update = composeProductUpdate(p, plan, new Map([[`${WP}/smoked.jpg`, uploadedRef(key)]]));

    expect(update.images).toHaveLength(2);
    expect(update.images[1]).toMatchObject({ public_id: key, variantOwned: true, isPrimary: false });
    expect(update.variants[0].imageKey).toBe(key);
  });

  test('the EXISTING primary and gallery order are untouched', () => {
    const p = product({
      images: [img('pack', { isPrimary: true }), img('lifestyle')],
      variants: [{ _id: 'v1', wpVariationId: 11 }],
    });
    const plan = planProductBackfill(p, [wcVar(11, `${WP}/smoked.jpg`)]);
    const update = composeProductUpdate(p, plan, new Map([[`${WP}/smoked.jpg`, uploadedRef(plan.uploads[0].key)]]));

    expect(update.images.map((i) => i.public_id).slice(0, 2)).toEqual(['pack', 'lifestyle']);
    expect(update.images[0].isPrimary).toBe(true);
    expect(update.images.filter((i) => i.isPrimary)).toHaveLength(1);
  });

  test('a shared photo is appended ONCE and pointed at by both models', () => {
    const p = product({
      variants: [{ _id: 'v1', wpVariationId: 11 }, { _id: 'v2', wpVariationId: 22 }],
    });
    const plan = planProductBackfill(p, [wcVar(11, `${WP}/same.jpg`), wcVar(22, `${WP}/same.jpg`)]);
    const update = composeProductUpdate(p, plan, new Map([[`${WP}/same.jpg`, uploadedRef(plan.uploads[0].key)]]));

    expect(update.appended).toBe(1);
    expect(update.pointed).toBe(2);
    expect(update.variants.map((v) => v.imageKey)).toEqual([plan.uploads[0].key, plan.uploads[0].key]);
  });

  test('a reused asset is pointed at WITHOUT a second gallery row', () => {
    const key = keyFor('p1', `${WP}/smoked.jpg`);
    const p = product({
      images: [img(key, { variantOwned: true })],
      variants: [{ _id: 'v1', wpVariationId: 11 }],
    });
    const plan = planProductBackfill(p, [wcVar(11, `${WP}/smoked.jpg`)]);
    const update = composeProductUpdate(p, plan, new Map([[`${WP}/smoked.jpg`, uploadedRef(key)]]));

    expect(update.images).toHaveLength(1);
    expect(update.appended).toBe(0);
    expect(update.variants[0].imageKey).toBe(key);
  });

  test('an upload that FAILED leaves its model untouched, others still apply', () => {
    const p = product({
      variants: [{ _id: 'v1', wpVariationId: 11 }, { _id: 'v2', wpVariationId: 22 }],
    });
    const plan = planProductBackfill(p, [wcVar(11, `${WP}/ok.jpg`), wcVar(22, `${WP}/broken.jpg`)]);
    const okKey = plan.uploads.find((u) => u.sourceUrl.endsWith('ok.jpg')).key;

    // Only the first upload succeeded.
    const update = composeProductUpdate(p, plan, new Map([[`${WP}/ok.jpg`, uploadedRef(okKey)]]));

    expect(update.appended).toBe(1);
    expect(update.variants[0].imageKey).toBe(okKey);
    expect(update.variants[1].imageKey).toBeUndefined();
  });

  test('returns null when nothing succeeded, so no empty write is issued', () => {
    const p = product({ variants: [{ _id: 'v1', wpVariationId: 11 }] });
    const plan = planProductBackfill(p, [wcVar(11, `${WP}/a.jpg`)]);
    expect(composeProductUpdate(p, plan, new Map())).toBeNull();
  });

  test('does not mutate the input product', () => {
    const p = product({
      images: [img('pack', { isPrimary: true })],
      variants: [{ _id: 'v1', wpVariationId: 11 }],
    });
    const plan = planProductBackfill(p, [wcVar(11, `${WP}/a.jpg`)]);
    composeProductUpdate(p, plan, new Map([[`${WP}/a.jpg`, uploadedRef(plan.uploads[0].key)]]));

    expect(p.images).toHaveLength(1);
    expect(p.variants[0].imageKey).toBeUndefined();
  });
});

describe('summarise', () => {
  test('aggregates the numbers a human signs off on', () => {
    const p1 = product({ variants: [{ _id: 'v1', wpVariationId: 11 }, { _id: 'v2', wpVariationId: 22 }] });
    const p2 = product({ variants: [{ _id: 'v3', wpVariationId: 33, imageKey: 'done' }] });

    const totals = summarise([
      planProductBackfill(p1, [wcVar(11, `${WP}/same.jpg`), wcVar(22, `${WP}/same.jpg`)]),
      planProductBackfill(p2, [wcVar(33, `${WP}/x.jpg`)]),
    ]);

    expect(totals).toMatchObject({
      products: 2, productsWithWork: 1, uploads: 1, reused: 0, pointers: 2,
    });
    expect(totals.skipped[SKIP.ALREADY]).toBe(1);
  });
});

// ── Label fallback: recovering models whose wpVariationId was destroyed ──────

describe('matchByLabel', () => {
  const wc = (id, ...options) => ({ id, attributes: options.map((option) => ({ option })) });

  test('normalises case, spacing and punctuation', () => {
    expect(normaliseLabel('COROLLA ALTIS 1.8 P')).toBe(normaliseLabel('corolla-altis 1 8 p'));
    expect(normaliseLabel('  Amber / Black ')).toBe('amber black');
  });

  test('pairs a model to its Woo variation by label', () => {
    const out = matchByLabel(
      [{ _id: 'v1', label: 'Amber' }, { _id: 'v2', label: 'Black' }],
      [wc(101, 'Black'), wc(102, 'Amber')],
    );
    expect(out.get('v1').id).toBe(102);
    expect(out.get('v2').id).toBe(101);
  });

  test('REFUSES an ambiguous label on our side rather than guessing', () => {
    const out = matchByLabel(
      [{ _id: 'v1', label: 'Black' }, { _id: 'v2', label: 'black' }],
      [wc(101, 'Black')],
    );
    expect(out.size).toBe(0);
  });

  test('REFUSES an ambiguous label on the Woo side too', () => {
    const out = matchByLabel(
      [{ _id: 'v1', label: 'Black' }],
      [wc(101, 'Black'), wc(102, 'black')],
    );
    expect(out.size).toBe(0);
  });

  test('a label with no counterpart is simply unmatched', () => {
    expect(matchByLabel([{ _id: 'v1', label: 'Purple' }], [wc(101, 'Black')]).size).toBe(0);
  });

  test('joins multi-attribute options the way the importer does', () => {
    const out = matchByLabel([{ _id: 'v1', label: 'Black / XL' }], [wc(101, 'Black', 'XL')]);
    expect(out.get('v1').id).toBe(101);
  });
});

describe('planProductBackfill — label fallback', () => {
  const WPU = 'https://autobacsindia.com/wp-content/uploads/2025/05';
  const wcFull = (id, option, src) => ({
    id, attributes: [{ option }], ...(src && { image: { src } }),
  });

  const severed = () => product({
    variants: [
      { _id: 'v1', label: 'Amber' },   // wpVariationId destroyed by an admin save
      { _id: 'v2', label: 'Black' },
    ],
  });
  const woo = () => [wcFull(101, 'Amber', `${WPU}/amber.jpg`), wcFull(102, 'Black', `${WPU}/black.jpg`)];

  test('OFF by default — a severed model stays unmatched', () => {
    const plan = planProductBackfill(severed(), woo());
    expect(plan.uploads).toHaveLength(0);
    expect(plan.skipped.every((s) => s.reason === SKIP.UNMATCHED)).toBe(true);
  });

  test('ON — recovers the photo and reports which models were label-matched', () => {
    const plan = planProductBackfill(severed(), woo(), { allowLabelMatch: true });
    expect(plan.uploads).toHaveLength(2);
    expect(plan.labelMatched.map((m) => m.variantId)).toEqual(['v1', 'v2']);
  });

  test('records BOTH sides of a fuzzy match, so the review is checkable', () => {
    const plan = planProductBackfill(severed(), woo(), { allowLabelMatch: true });
    expect(plan.labelMatched[0]).toMatchObject({
      variantId: 'v1',
      ourLabel: 'Amber',
      wcVariationId: 101,
      wcLabel: 'Amber',
      sourceUrl: expect.stringContaining('amber.jpg'),
    });
  });

  test('an id match always WINS over a similar label', () => {
    const p = product({
      variants: [{ _id: 'v1', label: 'Amber', wpVariationId: 102 }], // label says Amber, id says Black
    });
    const plan = planProductBackfill(p, woo(), { allowLabelMatch: true });
    expect(plan.uploads[0].sourceUrl).toContain('black.jpg');
    expect(plan.labelMatched).toEqual([]);
  });

  test('still never overwrites a photo the admin already set', () => {
    const p = product({ variants: [{ _id: 'v1', label: 'Amber', imageKey: 'admin-choice' }] });
    const plan = planProductBackfill(p, woo(), { allowLabelMatch: true });
    expect(plan.uploads).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe(SKIP.ALREADY);
  });
});
