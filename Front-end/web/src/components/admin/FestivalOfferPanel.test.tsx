import { describeTiers } from './FestivalOfferPanel';
import { findFestivalOfferLine } from '@/lib/festival/festivalOfferQuote';

describe('describeTiers — the admin reads the ladder in plain words', () => {
  it('describes the server ladder with inclusive boundaries', () => {
    expect(describeTiers([
      { minPaise: 2_00_000_00 + 1, percent: 2 },
      { minPaise: 1_00_000_00 + 1, percent: 3 },
      { minPaise: 0, percent: 10 },
      { minPaise: 50_000_00, percent: 5 },
    ])).toEqual([
      'Below ₹50,000 → 10% off',
      '₹50,000 to ₹1,00,000 → 5% off',
      'Above ₹1,00,000 up to ₹2,00,000 → 3% off',
      'Above ₹2,00,000 → 2% off',
    ]);
  });
});

describe('findFestivalOfferLine — cart/checkout read the SERVER line', () => {
  const quote = {
    festivalOfferLines: [
      { product: 'p1', variantId: null, quantity: 1, percent: 10, basePrice: 40000, priceBeforeOffer: 40000, discount: 4000, finalPrice: 36000 },
      { product: 'p2', variantId: 'v2', quantity: 2, percent: 3, basePrice: 110000, priceBeforeOffer: 110000, discount: 3300, finalPrice: 106700 },
    ],
  };

  it('matches on product AND variant', () => {
    expect(findFestivalOfferLine(quote, 'p1')?.finalPrice).toBe(36000);
    expect(findFestivalOfferLine(quote, 'p2', 'v2')?.finalPrice).toBe(106700);
    expect(findFestivalOfferLine(quote, 'p2', 'other')).toBeNull();
    expect(findFestivalOfferLine(quote, 'p2')).toBeNull();
  });

  it('is null with no quote, or a quote from an API without the field (mid-deploy)', () => {
    expect(findFestivalOfferLine(null, 'p1')).toBeNull();
    expect(findFestivalOfferLine({}, 'p1')).toBeNull();
  });
});
