import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AdminBrandsPage from './page';
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
  Package: () => <span data-testid="icon-package">Package</span>,
  ToggleLeft: () => <span data-testid="icon-toggle-left">ToggleLeft</span>,
  ToggleRight: () => <span data-testid="icon-toggle-right">ToggleRight</span>,
}));

// Mock Image
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ fill, ...props }: any) => <img {...props} data-filled={fill ? "true" : undefined} />,
}));

describe('AdminBrandsPage', () => {
  const mockBrands = [
    {
      id: 'b1',
      name: 'Brand 1',
      slug: 'brand-1',
      logo: '/brand1.png',
      isActive: true,
      productCount: 10
    },
    {
      id: 'b2',
      name: 'Brand 2',
      slug: 'brand-2',
      isActive: false,
      productCount: 5
    }
  ];

  const mockResponse = {
    brands: mockBrands,
    pagination: {
      total: 2,
      page: 1,
      pages: 1,
      limit: 20,
      hasNext: false,
      hasPrev: false
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    (apiClient.patch as jest.Mock).mockResolvedValue({ success: true });
    
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('renders loading state initially', async () => {
    // Return empty array initially to show "Loading..." if brands.length is 0
    (apiClient.get as jest.Mock).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockResponse), 100)));
    
    render(<AdminBrandsPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  });

  it('renders brands list after fetch', async () => {
    render(<AdminBrandsPage />);

    await waitFor(() => {
      expect(screen.getByText('Brand 1')).toBeInTheDocument();
      expect(screen.getByText('Brand 2')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument(); // product count
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
  });

  it('handles search with debounce', async () => {
    jest.useFakeTimers();
    render(<AdminBrandsPage />);

    await waitFor(() => {
      expect(screen.getByText('Brand 1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search brands...');
    fireEvent.change(searchInput, { target: { value: 'searchterm' } });

    // Advance timers to trigger debounce
    act(() => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('search=searchterm')
      );
    });

    jest.useRealTimers();
  });

  it('handles delete brand', async () => {
    render(<AdminBrandsPage />);

    await waitFor(() => {
      expect(screen.getByText('Brand 1')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      // API_ENDPOINTS.BRAND_DELETE(id) logic assumption, assuming it returns /brands/b1
      // If we don't know exact string, we can just check call
      expect(apiClient.delete).toHaveBeenCalled();
    });
  });

  it('handles toggle status', async () => {
    render(<AdminBrandsPage />);

    await waitFor(() => {
      expect(screen.getByText('Brand 1')).toBeInTheDocument();
    });

    const toggleButton = screen.getByTitle('Deactivate'); // Brand 1 is active
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalled();
      // Should refetch
      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });
  });

  it('handles empty state', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      brands: [],
      pagination: { total: 0, page: 1, pages: 1 }
    });

    render(<AdminBrandsPage />);

    await waitFor(() => {
      expect(screen.getByText('No brands found.')).toBeInTheDocument();
    });
  });
});
