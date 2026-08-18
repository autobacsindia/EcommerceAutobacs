import mongoose from 'mongoose';
import SeoSchema from '../models/shared/seoSchema.js';
import { normalizeSeo, SEO_FIELD_CAPS } from '../utils/seo.js';

/**
 * Contract guard for the shared SEO normalizer.
 *
 * `normalizeSeo()` is the ONLY thing standing between a free-typed admin SEO
 * field and the model. Every entity that embeds SeoSchema (Product, Brand,
 * Category, Article, JobPosting, PageSeo) writes through it, and the product
 * update path uses `findByIdAndUpdate(..., { runValidators: true })` — so
 * anything the normalizer lets through that the schema rejects surfaces as a
 * Mongoose ValidationError.
 *
 * That failure mode is genuinely nasty in production: the error middleware
 * whitelists the message down to the bare string "Validation Error", so an admin
 * gets an alert naming no field and simply cannot save the entity.
 *
 * It happened. The caps were hand-copied into a literal in utils/seo.js and
 * `canonical` drifted — 1000 in the normalizer vs. 500 in the schema — so a
 * pasted long canonical URL passed normalization and died at the validator,
 * bricking saves for that product.
 *
 * The load-bearing assertion here is the invariant, not the individual cases:
 * ANY output of normalizeSeo must validate against SeoSchema.
 */

// Standalone parent so we exercise SeoSchema exactly as it is embedded, without
// dragging a full model (and its hooks/indexes) into a pure unit test.
const SeoHost = mongoose.model(
  'SeoNormalizationTestHost',
  new mongoose.Schema({ seo: { type: SeoSchema, default: () => ({}) } })
);

/** Validate a normalizer output against the real schema. Returns field paths that failed. */
const schemaErrorsFor = (seo) => {
  const err = new SeoHost({ seo }).validateSync();
  return err ? Object.keys(err.errors) : [];
};

const LONG_URL_PATH = (n) => 'https://autobacsindia.com/products/' + 'a'.repeat(n);

describe('normalizeSeo → SeoSchema contract', () => {
  describe('caps are read off the schema, never restated', () => {
    it.each(Object.keys(SEO_FIELD_CAPS))('%s cap matches the schema maxlength', (field) => {
      expect(SEO_FIELD_CAPS[field]).toBe(SeoSchema.path(field).options.maxlength);
    });
  });

  describe('every normalized payload validates (the invariant)', () => {
    // Each case is an input that could plausibly reach the normalizer from the
    // admin panel or an importer, at or well past the schema limits.
    const cases = {
      'over-long canonical (the production bug)': { canonical: LONG_URL_PATH(600) },
      'canonical exactly at the cap':             { canonical: LONG_URL_PATH(0).padEnd(500, 'x') },
      'canonical one over the cap':               { canonical: LONG_URL_PATH(0).padEnd(501, 'x') },
      'over-long ogImage':                        { ogImage: 'https://res.cloudinary.com/' + 'b'.repeat(2000) },
      'over-long metaTitle':                      { metaTitle: 'x'.repeat(500) },
      'over-long metaDescription':                { metaDescription: 'y'.repeat(2000) },
      'over-long focusKeyword':                   { focusKeyword: 'z'.repeat(400) },
      'every field over its cap at once': {
        metaTitle: 'x'.repeat(500),
        metaDescription: 'y'.repeat(2000),
        focusKeyword: 'z'.repeat(400),
        canonical: LONG_URL_PATH(900),
        ogImage: 'https://res.cloudinary.com/' + 'b'.repeat(2000),
        noindex: 'true',
      },
      'site-relative over-long canonical': { canonical: '/products/' + 'c'.repeat(800) },
      'html injected into text fields':    { metaTitle: '<script>alert(1)</script>Title' },
      'blank everything':                  { metaTitle: '', metaDescription: '', canonical: '', ogImage: '' },
      'unknown keys':                      { evil: 'x'.repeat(5000), metaTitle: 'ok' },
      'non-string values':                 { metaTitle: 42, canonical: {}, ogImage: [], noindex: 1 },
    };

    it.each(Object.entries(cases))('%s', (_name, raw) => {
      expect(schemaErrorsFor(normalizeSeo(raw))).toEqual([]);
    });

    it.each([undefined, null, '', 'not json', '[]', '{"metaTitle":"ok"}', [], 0, false])(
      'tolerates a malformed payload: %p',
      (raw) => {
        const out = normalizeSeo(raw);
        expect(out).toEqual(expect.any(Object));
        expect(schemaErrorsFor(out)).toEqual([]);
      }
    );
  });

  describe('URL fields are dropped, not truncated, when over the cap', () => {
    // Slicing a URL yields a DIFFERENT, usually nonexistent URL. A truncated
    // canonical would emit <link rel="canonical"> pointing at a dead route —
    // worse than emitting none, which self-canonicalises.
    it('drops an over-long canonical entirely', () => {
      expect(normalizeSeo({ canonical: LONG_URL_PATH(600) }).canonical).toBeUndefined();
    });

    it('drops an over-long ogImage entirely', () => {
      expect(normalizeSeo({ ogImage: 'https://res.cloudinary.com/' + 'b'.repeat(2000) }).ogImage)
        .toBeUndefined();
    });

    it('keeps a URL sitting exactly on the cap', () => {
      const atCap = 'https://autobacsindia.com/'.padEnd(SEO_FIELD_CAPS.canonical, 'x');
      expect(atCap).toHaveLength(SEO_FIELD_CAPS.canonical);
      expect(normalizeSeo({ canonical: atCap }).canonical).toBe(atCap);
    });

    it('still rejects non-http, non-relative URLs', () => {
      expect(normalizeSeo({ canonical: 'javascript:alert(1)' }).canonical).toBeUndefined();
      expect(normalizeSeo({ ogImage: 'data:image/png;base64,AAAA' }).ogImage).toBeUndefined();
    });
  });

  describe('text fields are truncated to the cap', () => {
    // A shortened title is still a usable title, so truncation is right here —
    // the opposite call from URLs above.
    it('truncates metaTitle rather than dropping it', () => {
      const out = normalizeSeo({ metaTitle: 'x'.repeat(500) });
      expect(out.metaTitle).toHaveLength(SEO_FIELD_CAPS.metaTitle);
    });

    it('truncates metaDescription rather than dropping it', () => {
      const out = normalizeSeo({ metaDescription: 'y'.repeat(2000) });
      expect(out.metaDescription).toHaveLength(SEO_FIELD_CAPS.metaDescription);
    });
  });

  describe('existing behaviour is preserved', () => {
    it('keeps only known keys', () => {
      expect(normalizeSeo({ metaTitle: 'A', bogus: 'B' })).toEqual({ metaTitle: 'A' });
    });

    it('strips HTML and collapses whitespace in text fields', () => {
      expect(normalizeSeo({ metaTitle: '  <b>Hello</b>   world  ' }).metaTitle).toBe('Hello world');
    });

    it('drops blank fields so they never shadow computed defaults', () => {
      expect(normalizeSeo({ metaTitle: '   ', canonical: '' })).toEqual({});
    });

    it('coerces noindex and omits it when falsy', () => {
      expect(normalizeSeo({ noindex: 'true' }).noindex).toBe(true);
      expect(normalizeSeo({ noindex: true }).noindex).toBe(true);
      expect(normalizeSeo({ noindex: 'false' }).noindex).toBeUndefined();
      expect(normalizeSeo({ noindex: false }).noindex).toBeUndefined();
    });

    it('parses a JSON-string payload (multipart form fields arrive as strings)', () => {
      expect(normalizeSeo('{"metaTitle":"From multipart"}')).toEqual({ metaTitle: 'From multipart' });
    });
  });
});
