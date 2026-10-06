import { computeSeoScore, productSeoScore, seoDataFromProduct, seoRating, type ScorableProduct } from './seoScore';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

/** Everything the base checks reward — scores 100. */
const complete: ScorableProduct = {
  name: 'Ironman Snorkel for Toyota Hilux Revo', // 37 chars
  slug: 'ironman-snorkel-for-toyota-hilux',
  description: `<h2>Overview</h2><p>${words(160)}</p><ul><li>Dust proof</li></ul>`,
  shortDescription: 'A heavy-duty snorkel that keeps dust and water out of the engine.',
  brand: 'Ironman 4x4',
  images: [
    { url: 'a.jpg', public_id: 'a', alt: 'Front' },
    { url: 'b.jpg', public_id: 'b', alt: 'Side' },
    { url: 'c.jpg', public_id: 'c', alt: 'Fitted' },
  ],
  categories: [{ _id: 'c1', name: 'Snorkel' }],
  tags: ['snorkel', 'hilux', 'toyota', 'offroad', 'ironman'],
  features: ['Rotomoulded', 'UV stable', 'Bolt-on'],
  whyChoose: ['Tested', 'Warranty', 'Fits factory points'],
};

describe('productSeoScore', () => {
  it('scores a fully filled product 100', () => {
    expect(productSeoScore(complete)).toBe(100);
  });

  it('tolerates missing fields; an empty product keeps only the "slug under 60 chars" 2 points', () => {
    // That quirk is the editor's existing rule, kept as-is so list and editor agree.
    expect(productSeoScore({})).toBe(2);
    expect(productSeoScore({ name: null, images: null, tags: null })).toBe(2);
  });

  it('drops by the exact points of each missing piece', () => {
    // No headings (−8) and no list (−7) in the description.
    expect(productSeoScore({ ...complete, description: `<p>${words(160)}</p>` })).toBe(85);
    // One of three images lacks alt text: alt check 5 → 2.
    expect(productSeoScore({
      ...complete,
      images: [...complete.images!.slice(0, 2), { url: 'c.jpg', public_id: 'c', alt: '' }],
    })).toBe(97);
    // No tags (−5), no brand (−5).
    expect(productSeoScore({ ...complete, tags: [], brand: '' })).toBe(90);
  });

  it('counts a single legacy `category` when `categories` is empty', () => {
    const noCats = productSeoScore({ ...complete, categories: [] });
    expect(productSeoScore({ ...complete, categories: [], category: 'c1' })).toBe(noCats + 5);
  });
});

describe('seoDataFromProduct — must load a product exactly as the editor does', () => {
  it('joins tags with ", ", keeps alt text, counts no new uploads', () => {
    const data = seoDataFromProduct(complete);
    expect(data.tagsInput).toBe('snorkel, hilux, toyota, offroad, ironman');
    expect(data.existingImages.map((i) => i.alt)).toEqual(['Front', 'Side', 'Fitted']);
    expect(data.newImageCount).toBe(0);
    expect(data.selectedCategories).toHaveLength(1);
  });
});

describe('computeSeoScore', () => {
  it('adds the 20-point keyword group only when a keyword is typed', () => {
    const data = seoDataFromProduct(complete);
    expect(computeSeoScore(data).groups).toHaveLength(6);
    const withKw = computeSeoScore(data, 'snorkel');
    expect(withKw.groups).toHaveLength(7);
    expect(withKw.groups[6].checks.reduce((s, c) => s + c.possible, 0)).toBe(20);
  });
});

describe('seoRating', () => {
  it.each([
    [100, 'Good'], [70, 'Good'], [69, 'Needs Work'], [40, 'Needs Work'], [39, 'Poor'], [0, 'Poor'],
  ])('%i is %s', (score, label) => {
    expect(seoRating(score).label).toBe(label);
  });
});
