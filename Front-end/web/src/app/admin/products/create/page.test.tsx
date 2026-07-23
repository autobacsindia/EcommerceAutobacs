import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateProductPage from './page';
import apiClient from '@/lib/api';
import { useRouter } from 'next/navigation';

// The page uses TanStack Query's useQueryClient (to invalidate the admin product
// list after create), so renders must be wrapped in a QueryClientProvider.
const renderWithClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

// Mock apiClient
jest.mock('@/lib/api');

// Mock useRouter
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock icons
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Upload: () => <span data-testid="icon-upload">Upload</span>,
  Plus: () => <span data-testid="icon-plus">Plus</span>,
  Minus: () => <span data-testid="icon-minus">Minus</span>,
  X: () => <span data-testid="icon-x">X</span>,
}));

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');

describe('CreateProductPage', () => {
  const mockPush = jest.fn();
  const mockBack = jest.fn();

  const mockCategories = [
    { _id: 'cat1', name: 'Category 1' },
    { _id: 'cat2', name: 'Suspension' },
  ];

  const mockVehicles = [
    { _id: 'veh1', make: 'Toyota', model: 'Corolla' },
    { _id: 'veh2', make: 'Honda', model: 'Civic' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      back: mockBack,
    });
    
    // Default mocks for API calls
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url === '/categories/admin/all?counts=false') {
        return Promise.resolve({ data: mockCategories });
      }
      if (url === '/vehicles') {
        return Promise.resolve({ vehicles: mockVehicles });
      }
      return Promise.resolve({});
    });
    
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it('renders form after fetching data', async () => {
    renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Product Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Category/i)).toBeInTheDocument();
      expect(screen.getByText('Toyota Corolla')).toBeInTheDocument();
    });
  });

  it('handles input changes', async () => {
    renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Product Name/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Product Name/i), { target: { value: 'New Product' } });
    expect(screen.getByLabelText(/Product Name/i)).toHaveValue('New Product');

    fireEvent.change(screen.getByLabelText(/Price/i), { target: { value: '100' } });
    expect(screen.getByLabelText(/Price/i)).toHaveValue(100);

    const activeCheckbox = screen.getByLabelText('Active');
    expect(activeCheckbox).toBeChecked(); // Initially true
    fireEvent.click(activeCheckbox);
    expect(activeCheckbox).not.toBeChecked();
  });

  it('handles vehicle selection', async () => {
    renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByText('Toyota Corolla')).toBeInTheDocument();
    });

    const checkbox = screen.getByLabelText('Toyota Corolla');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('handles form submission', async () => {
    renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Product Name/i)).toBeInTheDocument();
    });

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/Product Name/i), { target: { value: 'Test Product' } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Test Description' } });
    fireEvent.change(screen.getByLabelText(/Price/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Stock Quantity/i), { target: { value: '10' } });

    const submitButton = screen.getByRole('button', { name: /Create Product/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/products', expect.objectContaining({
        name: 'Test Product',
        description: 'Test Description',
        price: 100,
        stock: 10,
        isActive: true
      }));
    });
    
    expect(window.alert).toHaveBeenCalledWith('Product created successfully');
    expect(mockPush).toHaveBeenCalledWith('/admin/products');
  });

  it('handles dynamic features', async () => {
    renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByText('Add Feature')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Feature'));
    
    const featureInputs = screen.getAllByPlaceholderText('Feature description');
    expect(featureInputs).toHaveLength(2); // Initial 1 + Added 1

    fireEvent.change(featureInputs[1], { target: { value: 'New Feature' } });
    expect(featureInputs[1]).toHaveValue('New Feature');
  });

  it('handles image selection', async () => {
    renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Select Images')).toBeInTheDocument();
    });

    const file = new File(['(⌐□_□)'], 'chucknorris.png', { type: 'image/png' });
    const input = screen.getByLabelText('Select Images');
    
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });
});
