import { buildSlides } from './StoreHome';
import type { StoreHomeData, StoreProduct } from './storeData';

const prod = (id: string, over: Partial<StoreProduct> = {}): StoreProduct => ({
  id, name: `Part ${id}`, href: `/products/p${id}`, image: `/i${id}.jpg`,
  brand: 'Brand', price: 1000, rating: 0, reviews: 0, ...over,
});

const base: StoreHomeData = {
  categories: [],
  deals: [prod('d1', { price: 600, originalPrice: 1000 }), prod('d2'), prod('d3')],
  dealsTotal: 75,
  bestSellers: [prod('b1'), prod('b2'), prod('b3')],
  newArrivals: [prod('n1'), prod('n2'), prod('n3')],
  featured: [],
  categoryRows: [],
  brands: [],
  reviews: [],
} as unknown as StoreHomeData;

const imagesOf = (data: StoreHomeData) => buildSlides(data).map((s) => s.images);

describe('which photographs the hero banners use', () => {
  it('prefers the admin-featured products on the non-price banners', () => {
    /*
      The point of the change. Before, the banners could only illustrate
      themselves with whatever the ranking put first — and the deepest discount
      on the catalogue was a set of key cases. Ranking cannot fix that; only a
      person choosing can.
    */
    const [, vehicle, arrivals] = buildSlides({
      ...base,
      featured: [prod('f1'), prod('f2'), prod('f3')],
    });
    expect(vehicle.images).toEqual(['/if1.jpg', '/if2.jpg', '/if3.jpg']);
    expect(arrivals.images).toEqual(['/if1.jpg', '/if2.jpg', '/if3.jpg']);
  });

  it('NEVER puts a product that is not on offer into the discount banner', () => {
    /*
      The banner says "Up to X% off". Illustrating that with a product carrying
      no discount is a claim the catalogue does not support, so Featured must
      not override it — however good the photograph is.
    */
    const [deals] = buildSlides({
      ...base,
      featured: [prod('f1'), prod('f2'), prod('f3')], // none of these are deals
    });
    expect(deals.images).toEqual(['/id1.jpg', '/id2.jpg', '/id3.jpg']);
    for (const img of deals.images) {
      expect(base.deals.some((d) => d.image === img)).toBe(true);
    }
  });

  it('does promote a featured product that IS on offer, within the discount banner', () => {
    // Featured orders products inside a banner; it does not add them to one.
    const onOffer = base.deals[2];
    const [deals] = buildSlides({ ...base, featured: [prod('f1'), onOffer] });
    expect(deals.images[0]).toBe(onOffer.image); // promoted to the front
    expect(deals.images).not.toContain('/if1.jpg'); // the non-offer pick stays out
    for (const img of deals.images) {
      expect(base.deals.some((d) => d.image === img)).toBe(true);
    }
  });

  it('tops up from the banner’s own list when fewer than three are featured', () => {
    const [, vehicle] = buildSlides({ ...base, featured: [prod('f1')] });
    expect(vehicle.images[0]).toBe('/if1.jpg');  // the pick leads
    expect(vehicle.images).toHaveLength(3);
    expect(vehicle.images.slice(1)).toEqual(['/ib1.jpg', '/ib2.jpg']); // then best sellers
  });

  it('falls back entirely to the ranked lists when nothing is featured', () => {
    // A store that has ticked no boxes must still get full banners.
    const [dealImages] = imagesOf(base);
    expect(dealImages).toEqual(['/id1.jpg', '/id2.jpg', '/id3.jpg']);
  });

  it('never repeats a photo inside one banner', () => {
    // A featured product that is also a top deal must appear once, not twice.
    const sets = imagesOf({ ...base, featured: [base.deals[0]] });
    for (const images of sets) {
      expect(new Set(images).size).toBe(images.length);
    }
  });

  it('still states the real headline discount', () => {
    // Changing the photographs must not change what the banner claims.
    const [deals] = buildSlides({ ...base, featured: [prod('f1'), prod('f2'), prod('f3')] });
    expect(deals.title).toBe('Up to 40% off on top upgrades');
  });
});
