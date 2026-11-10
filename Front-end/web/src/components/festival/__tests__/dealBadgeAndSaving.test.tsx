import React from 'react';
import { render, screen } from '@testing-library/react';
import { FestivalThemeProvider } from '../FestivalThemeContext';
import { FestivalOfferProvider } from '../FestivalOfferContext';
import FestivalDealBadge from '../FestivalDealBadge';
import FestivalOfferTag from '../FestivalOfferTag';
import { applyFestivalOffer, totalSavingFromMrp, type PublicFestivalOffer } from '@/lib/festival/festivalOffer';
import type { PublicFestivalTheme } from '@/lib/festival/festivalTheme';

jest.mock('next/navigation', () => ({ usePathname: () => '/' }));
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: jest.fn() } }));

const HOUR = 3600_000;
const TIERS = [
  { minPaise: 0, percent: 10 },
  { minPaise: 50_000_00, percent: 5 },
  { minPaise: 1_00_000_00 + 1, percent: 3 },
  { minPaise: 2_00_000_00 + 1, percent: 2 },
];
const theme = {
  themeKey: 'diwali', startsAt: new Date(Date.now() - HOUR).toISOString(),
  endsAt: new Date(Date.now() + HOUR).toISOString(), live: true,
} as unknown as PublicFestivalTheme;
const offerCfg: PublicFestivalOffer = { code: 'diwali', startsAt: null, endsAt: null, live: true, tiers: TIERS };

const wrap = (ui: React.ReactNode, offer: PublicFestivalOffer | null = offerCfg) => render(
  <FestivalThemeProvider theme={theme} initialLive>
    <FestivalOfferProvider offer={offer} initialLive={!!offer}>{ui}</FestivalOfferProvider>
  </FestivalThemeProvider>,
);
const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

describe('"You save" counts the whole saving from M.R.P.', () => {
  it('roll bar example: sale saving plus Diwali saving', () => {
    const offer = applyFestivalOffer({ unitPrice: 75000 }, TIERS)!;
    expect(offer.finalPrice).toBe(71250);
    expect(totalSavingFromMrp(offer, 135680)).toBe(64430);
  });

  it('no M.R.P., or M.R.P. not above the price: only the Diwali saving', () => {
    const offer = applyFestivalOffer({ unitPrice: 12999 }, TIERS)!;
    expect(totalSavingFromMrp(offer, null)).toBe(1300);
    expect(totalSavingFromMrp(offer, 12999)).toBe(1300);
    expect(totalSavingFromMrp(offer, 5000)).toBe(1300);
  });

  it('keeps paise exact', () => {
    const offer = applyFestivalOffer({ unitPrice: 999.5 }, TIERS)!;
    expect(totalSavingFromMrp(offer, 1299.99)).toBeCloseTo(1299.99 - offer.finalPrice, 2);
  });

  it('the tag shows the total but keeps "Before Diwali" and the %', () => {
    const offer = applyFestivalOffer({ unitPrice: 75000 }, TIERS)!;
    render(<FestivalOfferTag offer={offer} formatMoney={fmt} mrp={135680} />);
    const tag = screen.getByTestId('festival-offer-tag');
    expect(tag).toHaveTextContent('Diwali offer −5%');
    expect(tag).toHaveTextContent('Before Diwali ₹75,000');
    expect(tag).toHaveTextContent('You save ₹64,430');
  });
});

describe('Diwali Deal tag follows the product\'s own offer', () => {
  it('shows on Automatic and Custom', () => {
    wrap(<><FestivalDealBadge price={75000} /><FestivalDealBadge price={75000} setting={{ mode: 'custom', percent: 7 }} /></>);
    expect(screen.getAllByTestId('festival-deal-badge')).toHaveLength(2);
  });

  it('is hidden for "No Diwali offer"', () => {
    wrap(<FestivalDealBadge price={75000} setting={{ mode: 'none' }} />);
    expect(screen.queryByTestId('festival-deal-badge')).toBeNull();
  });

  it('is hidden when the price offer is switched off', () => {
    wrap(<FestivalDealBadge price={75000} />, null);
    expect(screen.queryByTestId('festival-deal-badge')).toBeNull();
  });
});
