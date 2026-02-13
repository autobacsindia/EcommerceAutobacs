import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminProductsPage from './page';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock dependencies
jest.mock('@/lib/api');

// Mock icons
jest.mock('lucide-react', () => ({
  Plus: () => <span data-testid="icon-plus">Plus</span>,
  Edit: () => <span data-testid="icon-edit">Edit</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Search: () => <span data-testid="icon-search">Search</span>,
}));

describe('AdminProductsPage', () => {
  const mockProducts = {
    success: true,
    count: 2,
    total: 2,
    pages: 1,
    products: [
      { _id: 'p1', name: 'Product 1', price: 100, stock: 20, category: { name: 'Cat 1' }, featured: true },
      { _id: 'p2', name: 'Product 2', price: 50, stock: 5, category: { name: 'Cat 2' }, featured: false },
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue(mockProducts);
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    
    // Mock window.confirm
    window.confirm = jest.fn().mockReturnValue(true);
    // Mock window.alert
    window.alert = jest.fn();
  });

  it('renders products table after fetch', async () => {
    render(<AdminProductsPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('Product 2')).toBeInTheDocument();
      expect(screen.getByText('Cat 1')).toBeInTheDocument();
      expect(screen.getByText('Cat 2')).toBeInTheDocument();
      expect(screen.getByText('₹100.00')).toBeInTheDocument();
      expect(screen.getByText('₹50.00')).toBeInTheDocument();
    });
  });

  it('handles search input with debounce', async () => {
    jest.useFakeTimers();
    render(<AdminProductsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search products...');
    fireEvent.change(searchInput, { target: { value: 'test' } });

    // Fast-forward debounce timer
    await React.act(async () => {
        jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('search=test')
      );
    });

    jest.useRealTimers();
  });

  it('handles delete product', async () => {
    render(<AdminProductsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTestId('icon-trash');
    fireEvent.click(deleteButtons[0].closest('button')!);

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith(`${API_ENDPOINTS.PRODUCTS}/p1`);
      expect(screen.queryByText('Product 1')).not.toBeInTheDocument();
    });
  });

  it('handles pagination', async () => {
    // Setup mock for pagination
    const pagedMock = {
        ...mockProducts,
        total: 100,
        pages: 2,
        products: [mockProducts.products[0]] // Just one product for page 1
    };
    (apiClient.get as jest.Mock).mockResolvedValue(pagedMock);

    render(<AdminProductsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('Next')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('page=2')
      );
    });
  });
});
