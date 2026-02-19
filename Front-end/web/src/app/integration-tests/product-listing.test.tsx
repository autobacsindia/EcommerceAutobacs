
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProductsPageClient from '../products/page'; // Adjust path if needed
import apiClient from '@/lib/api';
import { useSearchParams, useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
  ApiError: class ApiError extends Error {
    category: string;
    constructor(message: string, category: string = 'unknown') {
      super(message);
      this.category = category;
      this.name = 'ApiError';
    }
  },
  ErrorCategory: {
    NETWORK: 'network',
    SERVER: 'server',
    TIMEOUT: 'timeout',
    UNKNOWN: 'unknown',
  },
}));

// Mock dynamic components
jest.mock('@/components/products/ProductGrid', () => {
  return function MockProductGrid({ products }: { products: any[] }) {
    return (
      <div data-testid="product-grid">
        {products.map((p) => (
          <div key={p._id} data-testid="product-item">
            {p.name}
          </div>
        ))}
      </div>
    );
  };
});

jest.mock('@/components/products/ProductFilters', () => {
  return function MockProductFilters() {
    return <div data-testid="product-filters">Filters</div>;
  };
});

jest.mock('@/components/layout/Pagination', () => {
  return function MockPagination({ currentPage, pagination }: { currentPage: number, pagination: any }) {
    return (
      <div data-testid="pagination">
        Page {currentPage} of {pagination?.pages || 1}
      </div>
    );
  };
});

jest.mock('@/components/products/ProductFetchError', () => {
  return function MockProductFetchError({ onRetry, error }: { onRetry: () => void, error: Error }) {
    return (
      <div data-testid="product-fetch-error">
        Error: {error.message}
        <button onClick={onRetry}>Retry</button>
      </div>
    );
  };
});

describe('Products Page Integration', () => {
  const mockPush = jest.fn();
  const mockRefresh = jest.fn();
  const mockGet = apiClient.get as jest.Mock;

  const mockProducts = [
    { _id: '1', name: 'Product 1', price: 100 },
    { _id: '2', name: 'Product 2', price: 200 },
  ];

  const mockPagination = {
    total: 2,
    pages: 1,
    currentPage: 1,
    hasNext: false,
    hasPrev: false,
    count: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush, refresh: mockRefresh });
    
    // Default search params
    const mockSearchParams = new URLSearchParams();
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
  });

  it('renders loading state initially', async () => {
    // Mock API to delay
    mockGet.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ products: [], pagination: {} }), 100)));
    
    render(<ProductsPageClient />);
    
    expect(screen.getByText(/loading products/i)).toBeInTheDocument();
  });

  it('renders products after successful fetch', async () => {
    mockGet.mockResolvedValue({ products: mockProducts, pagination: mockPagination });
    
    render(<ProductsPageClient />);
    
    await waitFor(() => {
      expect(screen.getByTestId('product-grid')).toBeInTheDocument();
    });
    
    expect(screen.getAllByTestId('product-item')).toHaveLength(2);
    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.getByText('Product 2')).toBeInTheDocument();
  });

  it('handles empty product list', async () => {
    mockGet.mockResolvedValue({ products: [], pagination: {} });
    
    render(<ProductsPageClient />);
    
    await waitFor(() => {
      const elements = screen.getAllByText(/no products found/i);
      expect(elements.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('handles fetch error', async () => {
    const originalError = console.error;
    console.error = jest.fn(); // Suppress console.error

    try {
      mockGet.mockRejectedValue(new Error('Failed to fetch'));
      
      render(<ProductsPageClient />);
      
      // Wait for retries to complete (3 retries: 500ms + 1000ms + 2000ms = 3.5s + overhead)
      await waitFor(() => {
        expect(screen.getByTestId('product-fetch-error')).toBeInTheDocument();
        expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument();
      }, { timeout: 10000 });
    } finally {
      console.error = originalError;
    }
  });

  it('handles sort change', async () => {
    mockGet.mockResolvedValue({ products: mockProducts, pagination: mockPagination });
    
    render(<ProductsPageClient />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/sort by/i)).toBeInTheDocument();
    });
    
    fireEvent.change(screen.getByLabelText(/sort by/i), { target: { value: 'price_asc' } });
    
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('sort=price_asc'));
  });

  it('handles show all toggle', async () => {
    mockGet.mockResolvedValue({ products: mockProducts, pagination: mockPagination });
    
    render(<ProductsPageClient />);
    
    await waitFor(() => {
      expect(screen.getByLabelText(/show all/i)).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByLabelText(/show all/i));
    
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('showAll=true'));
  });
});
