import cloudinaryLoader from './cloudinaryLoader';

const CLOUD = 'https://res.cloudinary.com/demo/image/upload';
const rest = 'v1783950357/autobacs/products/x.jpg';

describe('cloudinaryLoader', () => {
  it('passes non-Cloudinary URLs through untouched', () => {
    expect(cloudinaryLoader({ src: '/images/local.png', width: 400 })).toBe('/images/local.png');
    expect(cloudinaryLoader({ src: 'https://other.cdn/a.jpg', width: 400 })).toBe('https://other.cdn/a.jpg');
  });

  it('injects f_auto + c_limit + the requested width after /upload/', () => {
    const out = cloudinaryLoader({ src: `${CLOUD}/${rest}`, width: 400 });
    expect(out).toContain('/image/upload/');
    expect(out).toContain('f_auto');
    expect(out).toContain('c_limit');
    expect(out).toContain('w_400');
    expect(out.endsWith(`/${rest}`)).toBe(true);
  });

  it('applies a light sharpen (counters downscale + fractional-DPR softening)', () => {
    const out = cloudinaryLoader({ src: `${CLOUD}/${rest}`, width: 400 });
    // e_sharpen must land on the resized rendition, so it precedes the c_limit/w_ resize
    // in the component; keep it subtle (:60) — higher values push Cloudinary off WebP.
    expect(out).toContain('e_sharpen:60');
    expect(out).toMatch(/e_sharpen:60,c_limit,w_400/);
  });

  it('never double-transforms a URL that already carries a transform segment', () => {
    const already = `${CLOUD}/e_trim,f_auto,q_auto/${rest}`;
    expect(cloudinaryLoader({ src: already, width: 400 })).toBe(already);
  });

  it('does NOT treat a version segment or a plain folder as an existing transform', () => {
    // `v123…` has no underscore and `autobacs` is a folder — both must get a transform injected.
    const out = cloudinaryLoader({ src: `${CLOUD}/${rest}`, width: 400 });
    expect(out).toContain('f_auto,');
  });

  describe('quality tier (crispness on DPR-1 screens)', () => {
    // DPR is invisible to the loader, so we cannot tier by width without leaving
    // some common DPR-1 screen soft — every rendition gets q_auto:best.
    it.each([16, 256, 640, 1080, 1200, 1920])(
      'uses q_auto:best at width %i (cards, PDP, and full-bleed renditions alike)',
      (width) => {
        expect(cloudinaryLoader({ src: `${CLOUD}/${rest}`, width })).toContain('q_auto:best');
      },
    );

    it('honors an explicit caller quality over the best default', () => {
      const out = cloudinaryLoader({ src: `${CLOUD}/${rest}`, width: 256, quality: 82 });
      expect(out).toContain('q_82');
      expect(out).not.toContain('q_auto');
    });

    it('accepts an explicit quality of 0 (nullish check, not falsy)', () => {
      const out = cloudinaryLoader({ src: `${CLOUD}/${rest}`, width: 256, quality: 0 });
      expect(out).toContain('q_0');
      expect(out).not.toContain('q_auto');
    });
  });
});
