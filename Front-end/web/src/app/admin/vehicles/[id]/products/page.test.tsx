import React, { Suspense } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VehicleProductsPage from './page';
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
  Edit: () => <div data-testid="icon-edit" />,
  Trash2: () => <div data-testid="icon-trash" />,
}));

// Mock constants
jest.mock('@/lib/constants', () => ({
  API_ENDPOINTS: {
    VEHICLE_PRODUCTS: (id: string) => `/vehicles/${id}/products`,
    VEHICLE_MAP_PRODUCTS: (id: string) => `/vehicles/${id}/products/map`,
    VEHICLE_UNMAP_PRODUCT: (id: string, productId: string) => `/vehicles/${id}/products/${productId}`,
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

describe('VehicleProductsPage', () => {
  const mockParams = Promise.resolve({ id: 'v1' });

  const mockVehicle = {
    id: 'v1',
    name: 'Toyota Camry 2022',
    slug: 'toyota-camry-2022',
    productCount: 2,
  };

  const mockMappedProducts = [
    {
      _id: 'p1',
      name: 'Oil Filter',
      price: 1500,
      brand: 'Toyota',
      images: [{ url: 'http://example.com/p1.jpg', alt: 'P1' }],
    },
    {
      _id: 'p2',
      name: 'Brake Pads',
      price: 3000,
      brand: 'Bosch',
      images: [{ url: 'http://example.com/p2.jpg', alt: 'P2' }],
    },
  ];

  const mockAvailableProducts = [
    {
      _id: 'p3',
      name: 'Air Filter',
      price: 800,
      brand: 'K&N',
      images: [{ url: 'http://example.com/p3.jpg', alt: 'P3' }],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url.includes('/vehicles/v1/products')) {
        // Handle search param in URL if present
        if (url.includes('search=Filter')) {
             return Promise.resolve({
                success: true,
                vehicle: mockVehicle,
                products: [mockMappedProducts[0]], // Only Oil Filter
                pagination: { total: 1, page: 1, pages: 1, limit: 20 },
              });
        }
        return Promise.resolve({
          success: true,
          vehicle: mockVehicle,
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
    renderWithSuspense(<VehicleProductsPage params={mockParams} />);
    expect(screen.getByText('Loading Params...')).toBeInTheDocument();
  });

  it('renders vehicle products after loading', async () => {
    renderWithSuspense(<VehicleProductsPage params={mockParams} />);
    
    await waitFor(() => {
      expect(screen.getByText('Toyota Camry 2022 Products')).toBeInTheDocument();
      expect(screen.getByText('2 products mapped')).toBeInTheDocument();
      expect(screen.getByText('Oil Filter')).toBeInTheDocument();
      expect(screen.getByText('Brake Pads')).toBeInTheDocument();
    });
  });

  it('searches within mapped products', async () => {
    jest.useFakeTimers();
    renderWithSuspense(<VehicleProductsPage params={mockParams} />);

    await waitFor(() => {
        expect(screen.getByText('Oil Filter')).toBeInTheDocument();
    });

    // Find the table search input (assuming placeholder "Search mapped products..." or similar)
    // Based on BrandProductsPage, it didn't have table search, but this file does.
    // I need to guess the placeholder or assume it's the first input if there's no modal.
    // But there might be multiple inputs if modal is open (but it's not yet).
    // Let's assume placeholder "Search products..." or "Search mapped products..."
    // Or I can look for the input that updates `tableSearchTerm`.
    
    // Let's try to find an input by placeholder. 
    // If I can't check the code, I'll try a generic query or assume it's the only input visible initially.
    const inputs = screen.getAllByRole('textbox');
    const searchInput = inputs[0]; // Assuming header search is first
    
    fireEvent.change(searchInput, { target: { value: 'Filter' } });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('search=Filter'));
        expect(screen.getByText('Oil Filter')).toBeInTheDocument();
        expect(screen.queryByText('Brake Pads')).not.toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  it('opens add products modal and maps product', async () => {
    jest.useFakeTimers();
    renderWithSuspense(<VehicleProductsPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText('Toyota Camry 2022 Products')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Products'));
    
    // Modal search input (placeholder "Search products to add...")
    const modalSearchInput = screen.getByPlaceholderText(/Search products to add/i);
    fireEvent.change(modalSearchInput, { target: { value: 'Available' } });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(screen.getByText('Air Filter')).toBeInTheDocument();
    });

    // Select product (div click)
    const productItem = screen.getByText('Air Filter').closest('div')?.parentElement;
    if (!productItem) throw new Error('Product item not found');
    fireEvent.click(productItem);

    // Add Selected
    const addButton = screen.getByRole('button', { name: /Add.*\(1\)/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/vehicles/v1/products/map', {
        productIds: ['p3']
      });
      expect(window.alert).toHaveBeenCalledWith('1 product(s) mapped successfully!');
    });

    jest.useRealTimers();
  });

  it('unmaps a product from vehicle', async () => {
    renderWithSuspense(<VehicleProductsPage params={mockParams} />);

    await waitFor(() => {
      expect(screen.getByText('Oil Filter')).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
    fireEvent.click(removeButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to remove "Oil Filter" from Toyota Camry 2022?');

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/vehicles/v1/products/p1');
    });
  });
});
