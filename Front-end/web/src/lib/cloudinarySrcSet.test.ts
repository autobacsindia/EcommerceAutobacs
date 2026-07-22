import { cloudinarySrcSet, DEFAULT_WIDTHS } from './cloudinarySrcSet';

const BASE = 'https://res.cloudinary.com/dhwxtl6l8/image/upload';

describe('cloudinarySrcSet', () => {
  it('returns undefined for non-Cloudinary URLs', () => {
    expect(cloudinarySrcSet('https://images.unsplash.com/photo-1?w=800')).toBeUndefined();
    expect(cloudinarySrcSet('/images/home/hero.png')).toBeUndefined();
    expect(cloudinarySrcSet('')).toBeUndefined();
  });

  it('returns undefined for a Cloudinary URL without an /image/upload/ marker', () => {
    expect(
      cloudinarySrcSet('https://res.cloudinary.com/dhwxtl6l8/video/upload/v1/x.mp4'),
    ).toBeUndefined();
  });

  it('emits one candidate per width with the correct descriptor', () => {
    const set = cloudinarySrcSet(`${BASE}/f_auto,q_auto,c_limit,w_1920/v123/before.jpg`, [640, 1280]);
    expect(set).toBe(
      `${BASE}/f_auto,q_auto,c_limit,w_640/v123/before.jpg 640w, ` +
        `${BASE}/f_auto,q_auto,c_limit,w_1280/v123/before.jpg 1280w`,
    );
  });

  it('replaces the existing width rather than appending a second w_', () => {
    const set = cloudinarySrcSet(`${BASE}/f_auto,q_auto,c_limit,w_1920/v123/before.jpg`, [800])!;
    expect(set).toContain('w_800');
    expect(set).not.toContain('w_1920');
    expect((set.match(/w_/g) || []).length).toBe(1);
  });

  it('injects f_auto,q_auto,c_limit when the base URL carries no transform', () => {
    const set = cloudinarySrcSet(`${BASE}/v123/before.jpg`, [640])!;
    expect(set).toBe(`${BASE}/f_auto,q_auto,c_limit,w_640/v123/before.jpg 640w`);
  });

  it('preserves an unusual existing transform (e.g. e_trim) and adds missing essentials', () => {
    const set = cloudinarySrcSet(`${BASE}/e_trim/v123/logo.png`, [640])!;
    expect(set).toContain('e_trim');
    expect(set).toContain('f_auto');
    expect(set).toContain('q_auto');
    expect(set).toContain('c_limit');
    expect(set).toContain('w_640');
  });

  it('never duplicates an essential that is already present', () => {
    const set = cloudinarySrcSet(`${BASE}/f_auto,q_80,c_limit,w_1920/v1/x.jpg`, [640])!;
    expect((set.match(/f_/g) || []).length).toBe(1);
    expect((set.match(/q_/g) || []).length).toBe(1); // keeps q_80, does not add q_auto
    expect(set).toContain('q_80');
    expect((set.match(/c_/g) || []).length).toBe(1);
  });

  it('defaults to the full-bleed width ladder', () => {
    const set = cloudinarySrcSet(`${BASE}/f_auto,q_auto,c_limit,w_1920/v1/x.jpg`)!;
    for (const w of DEFAULT_WIDTHS) expect(set).toContain(`w_${w}`);
    // Candidates are joined by ', ' (comma+space); transform params use bare ','.
    expect(set.split(', ').length).toBe(DEFAULT_WIDTHS.length);
  });
});
