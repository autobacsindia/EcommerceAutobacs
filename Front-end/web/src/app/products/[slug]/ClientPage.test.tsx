import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientPage from './ClientPage'; // Default export (the wrapper)
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import { useCurrency } from '@/context/CurrencyContext';
import { useRouter, useSearchParams } from 'next/navigation';
jest.mock('@/hooks/queries/useDeliveryEstimates', () => ({
  useDeliveryEstimates: () => ({ estimates: null, pending: false }),
}));


// ── Hooks ──
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
  usePathname: () => '/products/p1',
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@/context/WishlistContext', () => ({ useWishlist: jest.fn() }));
jest.mock('@/context/CartContext', () => ({ useCart: jest.fn() }));
jest.mock('@/context/CurrencyContext', () => ({ useCurrency: jest.fn() }));

jest.mock('react-hot-toast', () => {
  const mockToast = jest.fn() as unknown as jest.Mock & { success: jest.Mock; error: jest.Mock };
  mockToast.success = jest.fn();
  mockToast.error = jest.fn();
  return { __esModule: true, default: mockToast, toast: mockToast };
});

// ── Child components (rendered as lightweight stubs) ──
jest.mock('@/components/products/redesign/Gallery', () => ({
  __esModule: true,
  default: ({ zeroDelivery }: { zeroDelivery?: boolean }) => (
    <div data-testid="gallery" data-zero-delivery={zeroDelivery ? 'yes' : 'no'}>Gallery</div>
  ),
}));
// Black Friday ₹0-delivery figures: the server decides; the page only passes it on.
let mockFeeWaivers: { live: boolean; products: Record<string, unknown> } | null = null;
const mockFeeIds: string[][] = [];
jest.mock('@/hooks/queries/useCardFeeWaivers', () => ({
  useCardFeeWaivers: (ids: string[]) => { mockFeeIds.push(ids); return { waivers: mockFeeWaivers, pending: false }; },
}));
jest.mock('@/components/products/QuestionForm', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/QuestionList', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/reviews', () => ({ Reviews: () => <div data-testid="reviews" /> }));
jest.mock('@/components/products/SimilarProductsSection', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/ComplementaryProductsSection', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/StickyCartBar', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/VehicleCards', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('@/components/products/SaleCountdown', () => ({
  __esModule: true,
  default: () => null,
  useSaleCountdown: () => ({ live: true, remaining: 0 }),
}));

// ClientPage now reads product data via useQuery, so it needs a QueryClient.
// No initialData is passed, so it fetches through the mocked apiClient (the
// original loading→resolved flow these tests assert).
const renderPDP = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('ClientPage', () => {
  const mockProduct = {
    _id: 'p1',
    name: 'Test Product',
    price: 1000,
    originalPrice: 1200,
    description: 'Test Description',
    shortDescription: 'Short Description',
    images: [{ url: 'test.jpg', alt: 'Test Image' }],
    stock: 'in',
    averageRating: 4.5,
    totalReviews: 10,
    sku: 'TEST-SKU',
    category: { name: 'Test Category' },
    brand: 'Test Brand',
    compatibleVehicles: [],
  };

  const mockRouter = { push: jest.fn(), replace: jest.fn() };
  const mockAddToCart = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true, user: { _id: 'user1' } });
    (useCart as jest.Mock).mockReturnValue({ addToCart: mockAddToCart });
    (useWishlist as jest.Mock).mockReturnValue({
      addToWishlist: jest.fn(),
      removeFromWishlist: jest.fn(),
      isInWishlist: jest.fn().mockReturnValue(false),
    });
    (useCurrency as jest.Mock).mockReturnValue({
      formatPrice: (price: number) => `₹${price.toLocaleString()}`,
    });
    (apiClient.get as jest.Mock).mockResolvedValue({ product: mockProduct });
  });

  it('photo + buy box can shrink to a 375px phone (no sideways scroll)', async () => {
    // jsdom has no layout, so pin the two CSS facts that prevent the overflow:
    // a single minmax(0,1fr) column and min-width:0 on both grid items. Without
    // them an 8-photo gallery's dots row widened the page to 404px on phones.
    renderPDP(<ClientPage slug="p1" />);
    const grid = await screen.findByTestId('pdp-main-grid');
    expect(grid).toHaveClass('grid-cols-1');
    expect(grid.children).toHaveLength(2);
    for (const cell of Array.from(grid.children)) expect(cell).toHaveClass('min-w-0');
  });

  describe('Black Friday ₹0 DELIVERY ribbon on the main photo (owner, 2026-11-20)', () => {
    afterEach(() => { mockFeeWaivers = null; mockFeeIds.length = 0; });

    it('orderable product + server waiver → the gallery shows the ribbon', async () => {
      mockFeeWaivers = { live: true, products: { p1: { save: 500 } } };
      renderPDP(<ClientPage slug="p1" />);
      await waitFor(() => expect(screen.getByTestId('gallery')).toHaveAttribute('data-zero-delivery', 'yes'));
      expect(mockFeeIds.at(-1)).toEqual(['p1']);
    });

    it('offer off (no waiver) → no ribbon', async () => {
      renderPDP(<ClientPage slug="p1" />);
      await waitFor(() => expect(screen.getByTestId('gallery')).toHaveAttribute('data-zero-delivery', 'no'));
    });

    it.each(['backorder', 'out'])('%s product → no ribbon and no waiver request for it', async (stock) => {
      mockFeeWaivers = { live: true, products: { p1: { save: 500 } } };
      (apiClient.get as jest.Mock).mockResolvedValue({ product: { ...mockProduct, stock } });
      renderPDP(<ClientPage slug="p1" />);
      await waitFor(() => expect(screen.getByTestId('gallery')).toHaveAttribute('data-zero-delivery', 'no'));
      expect(mockFeeIds.at(-1)).toEqual([]);
    });
  });

  it('renders product details after loading', async () => {
    renderPDP(<ClientPage slug="p1" />);
    expect(screen.getByText('Loading product…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    });

    expect(screen.getByText('₹1,000')).toBeInTheDocument();
    expect(screen.getByText('Short Description')).toBeInTheDocument();
    expect(screen.getByTestId('gallery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to cart/i })).toBeInTheDocument();
  });

  /*
    Regression (PageSpeed): the gallery and buy box were wrapped in <Reveal>, which
    renders at opacity 0 until the bundle hydrates and an observer fires — so the
    product photo and price were invisible behind every script on the page. Nothing
    above the fold may sit inside a hidden ancestor on first render.
  */
  it('renders the photo and price box visible, not faded in behind hydration', async () => {
    renderPDP(<ClientPage slug="p1" />);
    await screen.findByRole('heading', { name: 'Test Product' });

    const hiddenAncestor = (el: HTMLElement | null) => {
      for (let n = el; n; n = n.parentElement) {
        if (n.style.opacity === '0') return n;
      }
      return null;
    };
    expect(hiddenAncestor(screen.getByTestId('gallery'))).toBeNull();
    expect(hiddenAncestor(screen.getByRole('button', { name: /add to cart/i }))).toBeNull();
  });

  it('adds to cart with the selected quantity', async () => {
    renderPDP(<ClientPage slug="p1" />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }));
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    await waitFor(() => {
      // A simple product passes an optimistic snapshot and a null variantId
      // (variants only apply to variable products).
      expect(mockAddToCart).toHaveBeenCalledWith(
        'p1',
        2,
        expect.objectContaining({ name: 'Test Product', variantLabel: null }),
        null,
      );
    });
  });

  // ── A failed refresh must never pass for "this product does not exist" ──
  it('keeps the product on screen when a background refresh fails (dropped connection)', async () => {
    // Server already rendered the product; its client refresh hits a network error.
    (apiClient.get as jest.Mock).mockRejectedValue(Object.assign(new Error('Failed to fetch'), { status: 0 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ClientPage slug="p1" initialProduct={mockProduct as never} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    // Force the background refresh (in the browser: staleness, focus, reconnect…).
    await client.refetchQueries();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/products/slug/p1'));
    expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
    expect(screen.queryByText('Product not found')).not.toBeInTheDocument();
  });

  it('says "not found" only when the API really answers 404', async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    renderPDP(<ClientPage slug="gone" />);
    expect(await screen.findByText('Product not found')).toBeInTheDocument();
  });

  it('offers a retry instead of "not found" when nothing could be loaded', async () => {
    (apiClient.get as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { status: 0 }))
      .mockResolvedValue({ product: mockProduct });
    renderPDP(<ClientPage slug="p1" />);

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText(/couldn.t load this product/i)).toBeInTheDocument();
    expect(screen.queryByText('Product not found')).not.toBeInTheDocument();

    fireEvent.click(retry);
    expect(await screen.findByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
  });
});
