/**
 * The PDP "similar products" rail — specifically its campaign badge.
 *
 * This rail was the one PDP surface the campaign never reached: the buy box, the
 * cross-sell rail and every listing card announced the offer, and the row directly
 * beneath them priced the alternatives as if none existed. The tests here pin the two
 * rules the sibling surfaces already follow, because getting either wrong is a money
 * claim on a discovery surface.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SimilarProductsSection from './SimilarProductsSection';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
jest.mock('lucide-react', () => ({
  Gift: () => <span>gift</span>,
  // ProductRail, which wraps this section, draws its own scroll arrows.
  ChevronLeft: () => <span>prev</span>,
  ChevronRight: () => <span>next</span>,
}));

const mockGet = jest.fn();
jest.mock('@/lib/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));

// The REAL formatter's behaviour, not an approximation — see formatPriceMock.
// Switchable, because the defects this file guards are only visible in USD: in
// rupees a hand-rolled `₹` formatter and CurrencyContext emit identical bytes.
let currency: 'INR' | 'USD' = 'INR';
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPrice: (n: number, o?: { exact?: boolean }) =>
      currency === 'INR'
        ? require('@/test-utils/formatPriceMock').formatPriceMock(n, o)
        : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 83),
  }),
}));

const mockVisible = jest.fn<boolean, []>();
jest.mock('@/hooks/queries/useCampaign', () => ({
  useCampaignBadgeVisible: () => mockVisible(),
}));

const mockRates = jest.fn<{ data: { rates: Record<string, { percent: number }> } | undefined }, []>();
jest.mock('@/hooks/queries/useCampaignProductRates', () => ({
  ...jest.requireActual('@/hooks/queries/useCampaignProductRates'),
  useCampaignProductRates: () => mockRates(),
}));

const product = (over: Record<string, unknown> = {}) => ({
  _id: 'p1',
  name: 'Profender Storm Kit',
  slug: 'profender-storm-kit',
  price: 23000,
  stock: 'in',
  images: [{ url: '/x.jpg' }],
  ...over,
});

function renderRail(over: Record<string, unknown> = {}, percent = 8) {
  mockGet.mockResolvedValue({ success: true, products: [product(over)] });
  mockRates.mockReturnValue({ data: { rates: { p1: { percent } } } });
  return render(<SimilarProductsSection productId="parent" />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVisible.mockReturnValue(true);
  currency = 'INR';
});

describe('SimilarProductsSection campaign badge', () => {
  it('states the saving in rupees on an in-stock alternative', async () => {
    renderRail();
    expect(await screen.findByText('+₹1,840 off')).toBeInTheDocument();
  });

  it('never advertises a discount on a sold-out alternative', async () => {
    /* A sold-out item still earns a rate, but it cannot be checked out with — the same
       gate StoreProductCard and the cross-sell rail apply. Without it this rail promised
       money on something nobody could buy. */
    renderRail({ stock: 'out' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Profender Storm Kit' })).toBeInTheDocument());
    expect(screen.queryByText(/off/i)).not.toBeInTheDocument();
  });

  it('says nothing to a shopper the offer will not be honoured for', async () => {
    mockVisible.mockReturnValue(false);
    renderRail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Profender Storm Kit' })).toBeInTheDocument());
    expect(screen.queryByText(/off/i)).not.toBeInTheDocument();
  });

  it('labels a variable product’s saving as a floor, matching its "From" price', async () => {
    /* `price` on a variable product is its CHEAPEST variant, so the saving is a floor.
       A flat figure would be wrong for every model but one. */
    renderRail({ productType: 'variable', priceMin: 23000, priceMax: 90000 });
    expect(await screen.findByText('From +₹1,840 off')).toBeInTheDocument();
  });

  it('keeps the paise rather than rounding the promise upward', async () => {
    // 3% of ₹999 is ₹29.97 and the cart charges exactly that.
    renderRail({ price: 999 }, 3);
    expect(await screen.findByText('+₹29.97 off')).toBeInTheDocument();
  });
});

/*
  Indian grouping, pinned.

  Every assertion here uses a SIX-figure price on purpose. Below ₹1,00,000 the
  en-IN and en-US groupings are byte-identical ("₹23,000"), so a five-figure
  fixture passes against the bug and proves nothing — which is how the original
  defect shipped and stayed live.

  One limit worth knowing: what these DETECT depends on the runner's default
  locale. Node resolves to en-US on CI and on this machine, so the unpinned call
  produces "₹283,000" and they fail loudly. On an en-IN runner the buggy and
  fixed code emit the same string and they would pass either way. They are a
  genuine guard in the environment we actually run, not a proof of the call site.
*/
describe('SimilarProductsSection price formatting', () => {
  it('groups in lakhs, not thousands, whatever locale the runtime has', async () => {
    renderRail({ price: 283000 });
    expect(await screen.findByText('₹2,83,000')).toBeInTheDocument();
    expect(screen.queryByText('₹283,000')).not.toBeInTheDocument();
  });

  it('groups the struck-through MRP the same way', async () => {
    // The compare-at price took the identical un-localed call, so it broke in
    // lockstep — and a mismatched pair reads as two different currencies.
    renderRail({ price: 268000, originalPrice: 282000 });
    expect(await screen.findByText('₹2,68,000')).toBeInTheDocument();
    expect(screen.getByText('₹2,82,000')).toBeInTheDocument();
  });
});

/*
  Price and badge must quote the SAME currency.

  Only observable in USD. The saving used `formatSavingInr`, which hard-codes ₹,
  so in rupees it agreed with CurrencyContext byte for byte and every existing
  test above passed while the two were, in fact, unrelated formatters.
*/
describe('SimilarProductsSection currency consistency', () => {
  it('quotes the saving in the shopper’s currency, not always rupees', async () => {
    currency = 'USD';
    renderRail({ price: 268000 }, 8); // 8% of ₹2,68,000 = ₹21,440

    expect(await screen.findByText('$3,228.92')).toBeInTheDocument();
    expect(screen.getByText('+$258.31 off')).toBeInTheDocument();
    // The giveaway symptom: a rupee saving sitting under a dollar price.
    expect(screen.queryByText(/\+₹/)).not.toBeInTheDocument();
  });

  it('keeps the exact paise on the saving, in either currency', async () => {
    // ₹999 × 3% = ₹29.97. Rounding that up to "₹30 off" advertises a discount
    // the cart will not honour, so `exact` has to survive the formatter swap.
    renderRail({ price: 999 }, 3);
    expect(await screen.findByText('+₹29.97 off')).toBeInTheDocument();
  });
});
