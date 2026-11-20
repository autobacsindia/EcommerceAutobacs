/**
 * Home shelf tiles while the Black Friday ₹0-delivery offer is on (owner, 2026-11-20):
 * every tile in a row is the same shape — a ₹0 receipt on orderable tiles, a grey status
 * line on backorder / sold-out ones, and no "by Brand" line (only some deals have one).
 */
import { render, screen } from '@testing-library/react';
import ProductTile from './ProductTile';
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

it('offer on, orderable: receipt + ribbon + "Save ₹X+", no brand line', () => {
  render(<ProductTile p={tile()} feeWaiver={waiver} feeOfferLive />);
  expect(screen.getByTestId('zero-delivery-receipt')).toBeInTheDocument();
  expect(screen.getByTestId('zero-delivery-ribbon')).toBeInTheDocument();
  expect(screen.getByText('Save ₹12,223+')).toBeInTheDocument();
  expect(screen.queryByText(/by Profender/)).not.toBeInTheDocument();
});

it.each(['backorder', 'out'] as const)('offer on, %s: grey line, no ribbon, discount-only badge, no brand line', (stock) => {
  render(<ProductTile p={tile({ stock })} feeWaiver={waiver} feeOfferLive />);
  const line = screen.getByTestId('zero-delivery-unavailable');
  expect(line).toHaveClass('h-[92px]');
  expect(line).not.toHaveTextContent('₹0');
  expect(screen.queryByTestId('zero-delivery-ribbon')).not.toBeInTheDocument();
  expect(screen.getByText('Save ₹9,000')).toBeInTheDocument();
  expect(screen.queryByText(/by Profender/)).not.toBeInTheDocument();
});

it('offer off: the normal tile — brand line back, no receipt, no grey line', () => {
  render(<ProductTile p={tile({ stock: 'backorder' })} />);
  expect(screen.getByText('by Profender')).toBeInTheDocument();
  expect(screen.queryByTestId('zero-delivery-unavailable')).not.toBeInTheDocument();
  expect(screen.queryByTestId('zero-delivery-receipt')).not.toBeInTheDocument();
});
