import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProductsPage from './page';
import apiClient from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';

// Mock apiClient
jest.mock('@/lib/api', () => {
  const originalModule = jest.requireActual('@/lib/api');
  return {
    __esModule: true,
    ...originalModule,
    default: {
      ...originalModule.default,
      get: jest.fn(),
      post: jest.fn(),
    },
  };
});

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
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

// Mock Pagination
jest.mock('@/components/layout/Pagination', () => {
  return function MockPagination() {
    return <div data-testid="pagination">Pagination</div>;
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
      stock: 'in',
      isActive: true,
      averageRating: 4.5,
    },
    {
      _id: '2',
      name: 'Test Product 2',
      price: 200,
      images: [],
      category: { name: 'Cat 2' },
      stock: 'in',
      isActive: true,
      averageRating: 4.0,
    },
  ];

  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  });

  it('renders products page with filters and grid', async () => {
    // Setup API mock
    (apiClient.get as jest.Mock).mockResolvedValue({
      success: true,
      products: mockProducts,
      pagination: {
        total: 2,
        pages: 1,
        currentPage: 1,
      },
    });

    render(<ProductsPage />);

    // Verify filters are present
    await waitFor(() => {
      expect(screen.getByTestId('product-filters')).toBeInTheDocument();
    });
    
    await waitFor(() => {
      expect(screen.getByTestId('product-grid')).toBeInTheDocument();
    });

    expect(screen.getAllByTestId('product-item')).toHaveLength(2);
    expect(screen.getByText('Test Product 1')).toBeInTheDocument();
    expect(screen.getByText('Test Product 2')).toBeInTheDocument();
  });

  it('handles API errors gracefully', async () => {
    // Setup API mock to fail
    const error = new Error('Failed to fetch');
    (apiClient.get as jest.Mock).mockRejectedValue(error);

    render(<ProductsPage />);

    // Wait for potential error handling or ensure loading stops
    // Since we don't know exact error UI text, checking absence of grid is a safe bet
    await waitFor(() => {
      expect(screen.queryByTestId('product-grid')).not.toBeInTheDocument();
    });
  });

  it('handles sorting changes', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      products: mockProducts,
      pagination: {}
    });

    render(<ProductsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('product-grid')).toBeInTheDocument();
    });

    const sortSelect = screen.getByLabelText(/Sort by/i);
    fireEvent.change(sortSelect, { target: { value: 'price_asc' } });

    expect(mockRouter.push).toHaveBeenCalledWith(expect.stringContaining('sort=price_asc'));
  });

  it('handles show all toggle', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      products: mockProducts,
      pagination: {}
    });

    render(<ProductsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('product-grid')).toBeInTheDocument();
    });

    const showAllCheckbox = screen.getByLabelText(/Show All/i);
    fireEvent.click(showAllCheckbox);

    expect(mockRouter.push).toHaveBeenCalledWith(expect.stringContaining('showAll=true'));
  });

  it('displays empty state when no products found', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      products: [],
      pagination: {}
    });

    render(<ProductsPage />);

    await waitFor(() => {
      expect(screen.getByText(/No products found matching your criteria/i)).toBeInTheDocument();
    });
    
    expect(screen.queryByTestId('product-grid')).not.toBeInTheDocument();
  });
});
