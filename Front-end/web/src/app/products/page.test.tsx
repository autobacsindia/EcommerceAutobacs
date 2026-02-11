
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProductsPage from './page';
import apiClient from '@/lib/api';

// Mock apiClient
jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(() => new URLSearchParams()),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
  })),
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

jest.mock('@/components/vehicles/VehicleFilterSidebar', () => {
  return function MockVehicleFilterSidebar() {
    return <div data-testid="vehicle-filter-sidebar">Vehicle Filters</div>;
  };
});

describe('ProductsPage', () => {
  const mockProducts = [
    {
      _id: '1',
      name: 'Test Product 1',
      price: 100,
      images: [],
      category: { name: 'Cat 1' },
      stock: 10,
      isActive: true,
      averageRating: 4.5,
    },
    {
      _id: '2',
      name: 'Test Product 2',
      price: 200,
      images: [],
      category: { name: 'Cat 2' },
      stock: 5,
      isActive: true,
      averageRating: 4.0,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders products page with filters and grid', async () => {
    // Setup API mock
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      return Promise.resolve({
        success: true,
        products: mockProducts,
        pagination: {
          total: 2,
          pages: 1,
          currentPage: 1,
        },
      });
    });

    render(<ProductsPage />);

    // Verify loading state (skeleton) might be shown briefly, but we wait for content
    
    // Verify filters are present
    await waitFor(() => {
      expect(screen.getByTestId('product-filters')).toBeInTheDocument();
    });

    // Verify product grid is present and renders products
    await waitFor(() => {
      expect(screen.getByTestId('product-grid')).toBeInTheDocument();
      expect(screen.getByText('Test Product 1')).toBeInTheDocument();
      expect(screen.getByText('Test Product 2')).toBeInTheDocument();
    });

    // Verify API was called correctly
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/products'));
  });

  it('handles empty product list', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      products: [],
      pagination: {
        total: 0,
        pages: 0,
        currentPage: 1,
      },
    });

    render(<ProductsPage />);

    await waitFor(() => {
      expect(screen.getByText('No products found matching your criteria')).toBeInTheDocument();
    });
  });
});
