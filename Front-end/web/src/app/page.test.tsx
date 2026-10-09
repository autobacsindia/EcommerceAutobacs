/**
 * Home page — the light, Amazon-style store. The page is an async Server Component
 * that loads its shelves on the server, so this renders StoreHome with a fixed data
 * set and checks what a shopper sees.
 */
import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import ConditionalHeader from '@/components/layout/ConditionalHeader';
import ConditionalFooter from '@/components/layout/ConditionalFooter';
import StoreHome from '@/components/home/store/StoreHome';
import type { StoreHomeData, StoreProduct } from '@/components/home/store/storeData';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/' }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }));
jest.mock('@/context/CartContext', () => ({ useCart: () => ({ itemCount: 2 }) }));
jest.mock('@/context/CurrencyContext', () => ({ useCurrency: () => ({ formatPrice: (n: number) => `₹${n.toLocaleString('en-IN')}` }) }));
jest.mock('@/hooks/queries/useVehicleMakes', () => ({
  useVehicleMakes: () => ({ data: [{ _id: 'Toyota', name: 'Toyota' }, { _id: 'Kia', name: 'Kia' }] }),
  useVehicleModels: () => ({ data: ['Hilux'], isFetching: false }),
}));
jest.mock('@/components/home/redesign/Img', () => ({ __esModule: true, default: (p: { alt?: string }) => <img alt={p.alt} /> }));

beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
beforeEach(() => push.mockReset());

const prod = (id: string, over: Partial<StoreProduct> = {}): StoreProduct => ({
  id, name: `Part ${id}`, href: `/products/p${id}`, image: `/i${id}.jpg`, brand: 'Brand', price: 1000, rating: 0, reviews: 0, ...over,
});

const data: StoreHomeData = {
  categories: Array.from({ length: 8 }, (_, i) => ({ name: `Cat ${i}`, slug: `c${i}`, href: `/categories/c${i}`, image: `/c${i}.jpg` })),
  deals: [prod('d1', { price: 600, originalPrice: 1000 }), prod('d2', { price: 900, originalPrice: 1000 }), prod('d3', { price: 500, originalPrice: 2000 }), prod('d4', { price: 50, originalPrice: 100 })],
  dealsTotal: 75,
  bestSellers: [prod('b1'), prod('b2'), prod('b3'), prod('b4')],
  newArrivals: [prod('n1'), prod('n2'), prod('n3')],
  categoryRows: [{ category: { name: 'Lighting', slug: 'lighting', href: '/categories/lighting', image: '' }, products: [prod('l1'), prod('l2'), prod('l3'), prod('l4')] }],
  brands: [],
  reviews: [{ quote: 'Great fit.', name: 'Asha', rating: 4, verified: true }],
};

it('has one H1 and the main shelves', () => {
  render(<StoreHome data={data} />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  for (const t of ["Today's Deals", 'Best Sellers', 'Top in Lighting', 'New Arrivals', 'What customers say']) {
    expect(screen.getByRole('heading', { name: t })).toBeInTheDocument();
  }
});

it('advertises the real number of deals and the biggest real saving', () => {
  render(<StoreHome data={data} />);
  // Sample savings are 40%, 10%, 75% and 50% — the banner quotes the largest.
  expect(screen.getByText('Up to 75% off on top upgrades')).toBeInTheDocument();
  expect(screen.getByText(/75 products on sale now/)).toBeInTheDocument();
});

it('shows MRP and % off only on products that are genuinely on sale', () => {
  render(<StoreHome data={data} />);
  const deals = screen.getByRole('heading', { name: "Today's Deals" }).closest('section') as HTMLElement;
  expect(deals.querySelectorAll('.st-mrp')).toHaveLength(4);
  expect(within(deals).getByText('-40%')).toBeInTheDocument();
  const best = screen.getByRole('heading', { name: 'Best Sellers' }).closest('section') as HTMLElement;
  expect(best.querySelectorAll('.st-mrp')).toHaveLength(0);
  expect(within(best).getByText('#1 Best seller')).toBeInTheDocument();
});

it('skips a shelf with no products', () => {
  render(<StoreHome data={{ ...data, newArrivals: [] }} />);
  expect(screen.queryByRole('heading', { name: 'New Arrivals' })).toBeNull();
});

// The double-header bug: the home page drew its own header/footer and relied on the
// layout hiding its copies on '/'. On Vercel the ISR-regenerated page showed BOTH.
// Now there is one source — the layout — on every page, the home page included.
it('draws no header, promo strip or footer of its own', () => {
  const { container } = render(<StoreHome data={data} />);
  expect(container.querySelector('.sh-header')).toBeNull();
  expect(container.querySelector('footer')).toBeNull();
  expect(screen.queryByRole('searchbox')).toBeNull();
});

it('the layout header, search and footer appear on the home page exactly once', () => {
  const { container } = render(
    <>
      <ConditionalHeader navCategories={[{ label: 'Audio', href: '/categories/audio' }]} />
      <StoreHome data={data} />
      <ConditionalFooter />
    </>,
  );
  expect(container.querySelectorAll('.sh-header')).toHaveLength(1);
  expect(container.querySelectorAll('footer.sf')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Cart, 2 items' })).toHaveAttribute('href', '/cart');
  expect(screen.getByRole('link', { name: /back to top/i })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search products' }), { target: { value: 'hilux bumper' } });
  fireEvent.submit(screen.getByRole('search'));
  expect(push).toHaveBeenCalledWith('/products/search?q=hilux%20bumper');
});
