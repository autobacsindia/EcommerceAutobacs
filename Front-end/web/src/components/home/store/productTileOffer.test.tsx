/**
 * Home shelf tiles during Black Friday (owner, 2026-11-20): the shared diagonal
 * "₹0 DELIVERY" ribbon on orderable tiles only, no fee receipt box, and no "by Brand"
 * line while the festival is on (only some deals have a brand, so rows were uneven).
 */
import { render, screen } from '@testing-library/react';
import ProductTile from './ProductTile';
import { FestivalThemeProvider } from '@/components/festival/FestivalThemeContext';
import type { StoreProduct } from './storeData';

jest.mock('@/components/home/redesign/Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));
jest.mock('@/context/CurrencyContext', () => ({
  useCurrency: () => ({ formatPrice: (n: number, o?: { exact?: boolean }) => require('@/test-utils/formatPriceMock').formatPriceMock(n, o) }),
}));
jest.mock('@/components/festival/FestivalOfferContext', () => ({ useFestivalOfferPrice: () => null }));
jest.mock('@/components/festival/FestivalDealBadge', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/festival/FestivalOfferTag', () => ({ __esModule: true, default: () => null }));

const tile = (over: Partial<StoreProduct> = {}): StoreProduct => ({
  id: 'k', name: 'Profender King', href: '/products/k', image: '/k.jpg', brand: 'Profender',
  price: 283000, originalPrice: 292000, rating: 0, reviews: 0, stock: 'in', ...over,
});
const waiver = { discount: 9000, save: 12223.5, shipping: 1024, packing: 500, handling: 28.8, other: 1670.7, total: 3223.5 };
const BF = { themeKey: 'blackfriday', startsAt: null, endsAt: null, live: true };
const inBlackFriday = (ui: React.ReactElement) => render(<FestivalThemeProvider theme={BF} initialLive>{ui}</FestivalThemeProvider>);

it('orderable: diagonal ribbon + "Save ₹X+", no receipt box, no brand line', () => {
  inBlackFriday(<ProductTile p={tile()} feeWaiver={waiver} />);
  expect(screen.getByTestId('zero-delivery-ribbon').parentElement).toHaveClass('zd-ribbon-box');
  expect(screen.getByText('Save ₹12,223+')).toBeInTheDocument();
  expect(screen.queryByText(/You pay/)).not.toBeInTheDocument();
  expect(screen.queryByText(/by Profender/)).not.toBeInTheDocument();
});

it.each(['backorder', 'out'] as const)('%s: no ribbon, discount-only badge', (stock) => {
  inBlackFriday(<ProductTile p={tile({ stock })} feeWaiver={waiver} />);
  expect(screen.queryByTestId('zero-delivery-ribbon')).not.toBeInTheDocument();
  expect(screen.getByText('Save ₹9,000')).toBeInTheDocument();
});

it('outside Black Friday: the normal tile, brand line back', () => {
  render(<ProductTile p={tile()} />);
  expect(screen.getByText('by Profender')).toBeInTheDocument();
  expect(screen.queryByTestId('zero-delivery-ribbon')).not.toBeInTheDocument();
});
