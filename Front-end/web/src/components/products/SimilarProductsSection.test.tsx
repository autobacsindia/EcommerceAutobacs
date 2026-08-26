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
