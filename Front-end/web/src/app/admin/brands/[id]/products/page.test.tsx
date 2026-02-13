import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BrandProductsPage from './page';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ fill, ...props }: any) => <img {...props} data-filled={fill ? "true" : undefined} />,
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <div data-testid="icon-arrow-left" />,
  Search: () => <div data-testid="icon-search" />,
  Plus: () => <div data-testid="icon-plus" />,
  X: () => <div data-testid="icon-x" />,
  Loader2: () => <div data-testid="icon-loader" />,
  Check: () => <div data-testid="icon-check" />,
  Trash2: () => <div data-testid="icon-trash" />,
}));

// Mock constants
jest.mock('@/lib/constants', () => ({
  API_ENDPOINTS: {
    BRAND_PRODUCTS: (id: string) => `/brands/${id}/products`,
    BRAND_MAP_PRODUCTS: (id: string) => `/brands/${id}/products/map`,
    BRAND_UNMAP_PRODUCT: (id: string, productId: string) => `/brands/${id}/products/${productId}`,
    PRODUCTS: '/products',
  },
}));

const renderWithSuspense = (ui: React.ReactNode) => {
  return render(
    <Suspense fallback={<div>Loading Params...</div>}>
      {ui}
    </Suspense>
  );
};

describe('BrandProductsPage', () => {
  const mockParams = Promise.resolve({ id: 'b1' });

  const mockBrand = {
    id: 'b1',
    name: 'Test Brand',
    slug: 'test-brand',
    logo: 'http://example.com/logo.png',
    productCount: 2,
  };

  const mockMappedProducts = [
    {
      _id: 'p1',
      name: 'Product 1',
      price: 100,
      brand: 'Test Brand',
      images: [{ url: 'http://example.com/p1.jpg', alt: 'P1' }],
    },
    {
      _id: 'p2',
      name: 'Product 2',
      price: 200,
      brand: 'Test Brand',
      images: [{ url: 'http://example.com/p2.jpg', alt: 'P2' }],
    },
  ];

  const mockAvailableProducts = [
    {
      _id: 'p3',
      name: 'Available Product 3',
      price: 300,
      brand: 'Other Brand',
      images: [{ url: 'http://example.com/p3.jpg', alt: 'P3' }],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url.includes('/brands/b1/products')) {
        return Promise.resolve({
          success: true,
          brand: mockBrand,
          products: mockMappedProducts,
          pagination: { total: 2, page: 1, pages: 1, limit: 20 },
        });
      }
      if (url.includes('/products')) {
        return Promise.resolve({
          success: true,
          products: mockAvailableProducts,
          total: 1,
        });
      }
      return Promise.reject(new Error('Not found'));
    });

    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    
    window.alert = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
  });

  it('renders initial loading state (warmup)', async () => {
    // This test serves as a warmup for Suspense/use(promise) in Jest
    renderWithSuspense(<BrandProductsPage params={mockParams} />);
    expect(screen.getByText('Loading Params...')).toBeInTheDocument();
  });

  it('renders brand products after loading', async () => {
    renderWithSuspense(<BrandProductsPage params={mockParams} />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Brand Products')).toBeInTheDocument();
      expect(screen.getByText('2 products mapped')).toBeInTheDocument();
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('Product 2')).toBeInTheDocument();
    });
  });

  it('opens add products modal and searches for products', async () => {
    jest.useFakeTimers();
    renderWithSuspense(<BrandProductsPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText('Test Brand Products')).toBeInTheDocument();
    });

    // Open modal
    fireEvent.click(screen.getByText('Add Products'));
    
    // Search for products
    const searchInput = screen.getByPlaceholderText(/Search products/i);
    fireEvent.change(searchInput, { target: { value: 'Available' } });

    // Advance timer for debounce
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/products?search=Available'));
      expect(screen.getByText('Available Product 3')).toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  it('maps selected products to brand', async () => {
    jest.useFakeTimers();
    renderWithSuspense(<BrandProductsPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText('Test Brand Products')).toBeInTheDocument();
    });

    // Open modal and search
    fireEvent.click(screen.getByText('Add Products'));
    const searchInput = screen.getByPlaceholderText(/Search products/i);
    fireEvent.change(searchInput, { target: { value: 'Available' } });
    
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(screen.getByText('Available Product 3')).toBeInTheDocument();
    });

    // Select product (it's a div with onClick, not a checkbox)
    const productItem = screen.getByText('Available Product 3').closest('div')?.parentElement;
    if (!productItem) throw new Error('Product item not found');
    fireEvent.click(productItem);

    // Click Add Selected
    const addButton = screen.getByRole('button', { name: /Add.*\(1\)/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/brands/b1/products/map', {
        productIds: ['p3']
      });
      expect(window.alert).toHaveBeenCalledWith('1 product(s) mapped successfully!');
    });

    jest.useRealTimers();
  });

  it('unmaps a product from brand', async () => {
    renderWithSuspense(<BrandProductsPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    // Click Remove button for Product 1
    const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
    fireEvent.click(removeButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to remove "Product 1" from Test Brand?');

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/brands/b1/products/p1');
    });
  });
});
