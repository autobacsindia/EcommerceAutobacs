import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditBrandPage from './page';
import apiClient from '@/lib/api';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Save: () => <span data-testid="icon-save">Save</span>,
  Loader2: () => <span data-testid="icon-loader">Loader</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
}));

// Mock React.use to avoid Suspense issues in tests
jest.mock('react', () => {
  const original = jest.requireActual('react');
  return {
    ...original,
    use: () => ({ id: '123' }),
  };
});

describe('EditBrandPage', () => {
  const mockRouter = {
    back: jest.fn(),
    push: jest.fn(),
    refresh: jest.fn(),
  };

  const mockBrand = {
    id: '123',
    name: 'Test Brand',
    slug: 'test-brand',
    logo: 'http://example.com/logo.png',
    description: 'Test Description',
    isActive: true,
    productCount: 5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (apiClient.get as jest.Mock).mockResolvedValue({ success: true, brand: mockBrand });
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it('renders loading state initially', async () => {
    // Even with mocked use, the component has internal loading state
    const params = Promise.resolve({ id: '123' });
    render(<EditBrandPage params={params} />);
    
    // Should show loader from component state
    expect(screen.getByTestId('icon-loader')).toBeInTheDocument();
    
    await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalled();
    });
  });

  it('fetches and populates brand data', async () => {
    const params = Promise.resolve({ id: '123' });
    render(<EditBrandPage params={params} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Brand')).toBeInTheDocument();
      expect(screen.getByDisplayValue('http://example.com/logo.png')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test Description')).toBeInTheDocument();
      expect(screen.getByLabelText('Brand is active')).toBeChecked();
    });
    
    expect(screen.getByText('Edit Brand: Test Brand')).toBeInTheDocument();
    expect(screen.getByText('Manage Products (5)')).toBeInTheDocument();
  });

  it('updates brand successfully', async () => {
    const params = Promise.resolve({ id: '123' });
    render(<EditBrandPage params={params} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Brand')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Brand Name/i), { target: { value: 'Updated Brand' } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Updated Desc' } });
    
    const form = screen.getByRole('button', { name: /Save Changes/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(expect.stringContaining('123'), {
        name: 'Updated Brand',
        logo: 'http://example.com/logo.png',
        description: 'Updated Desc',
        isActive: true,
      });
    });
    
    expect(window.alert).toHaveBeenCalledWith('Brand updated successfully!');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/brands');
  });

  it('handles error when fetching brand', async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('Fetch failed'));
    const params = Promise.resolve({ id: '123' });
    render(<EditBrandPage params={params} />);

    await waitFor(() => {
      expect(screen.getByText('Fetch failed')).toBeInTheDocument();
    });
  });
});
