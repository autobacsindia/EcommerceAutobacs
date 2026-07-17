import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditBrandPage from './page';
import apiClient from '@/lib/api';
import { useRouter } from 'next/navigation';

// GET (load) still uses apiClient; the update now submits multipart via fetch.
jest.mock('@/lib/api');
jest.mock('@/lib/revalidateHome', () => ({ revalidateHome: jest.fn() }));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Save: () => <span data-testid="icon-save">Save</span>,
  Loader2: () => <span data-testid="icon-loader">Loader</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
  // Icons used by the embedded <SeoPanel> and <ImageUploader>.
  Search: () => <span data-testid="icon-search">Search</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronRight: () => <span data-testid="icon-chevron-right">ChevronRight</span>,
  Info: () => <span data-testid="icon-info">Info</span>,
  Upload: () => <span data-testid="icon-upload">Upload</span>,
  X: () => <span data-testid="icon-x">X</span>,
  ImageIcon: () => <span data-testid="icon-image">ImageIcon</span>,
}));

// Mock React.use to avoid Suspense issues in tests
jest.mock('react', () => {
  const original = jest.requireActual('react');
  return {
    ...original,
    use: () => ({ id: '123' }),
  };
});

const okJson = (body: unknown = { success: true }) =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) } as Response);

describe('EditBrandPage', () => {
  const mockRouter = { back: jest.fn(), push: jest.fn(), refresh: jest.fn() };

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
    global.fetch = jest.fn(() => okJson()) as jest.Mock;
    window.alert = jest.fn();
  });

  it('renders loading state initially', async () => {
    render(<EditBrandPage params={Promise.resolve({ id: '123' })} />);
    expect(screen.getByTestId('icon-loader')).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  });

  it('fetches and populates brand data', async () => {
    render(<EditBrandPage params={Promise.resolve({ id: '123' })} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test Brand')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test Description')).toBeInTheDocument();
      expect(screen.getByLabelText('Brand is active')).toBeChecked();
    });

    // Current logo shown as a preview image (not a URL input anymore).
    expect(screen.getByAltText('Current logo')).toHaveAttribute('src', 'http://example.com/logo.png');
    expect(screen.getByText('Edit Brand: Test Brand')).toBeInTheDocument();
    expect(screen.getByText('Manage Products (5)')).toBeInTheDocument();
  });

  it('updates brand via multipart PUT', async () => {
    render(<EditBrandPage params={Promise.resolve({ id: '123' })} />);

    await waitFor(() => expect(screen.getByDisplayValue('Test Brand')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Brand Name/i), { target: { value: 'Updated Brand' } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Updated Desc' } });

    const form = screen.getByRole('button', { name: /Save Changes/i }).closest('form');
    if (!form) throw new Error('Form not found');
    fireEvent.submit(form);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/v1/brands/123');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toBeInstanceOf(FormData);
    const fd = opts.body as FormData;
    expect(fd.get('name')).toBe('Updated Brand');
    expect(fd.get('description')).toBe('Updated Desc');
    expect(fd.get('isActive')).toBe('true');

    expect(window.alert).toHaveBeenCalledWith('Brand updated successfully!');
    expect(mockRouter.push).toHaveBeenCalledWith('/admin/brands');
  });

  it('handles error when fetching brand', async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('Fetch failed'));
    render(<EditBrandPage params={Promise.resolve({ id: '123' })} />);
    await waitFor(() => expect(screen.getByText('Fetch failed')).toBeInTheDocument());
  });
});
