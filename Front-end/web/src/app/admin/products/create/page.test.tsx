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
  // lib/usePanel reads the path to pick admin vs the marketing panel.
  usePathname: () => '/admin/products',
  useRouter: jest.fn(),
}));

// Mock icons
/*
  Stub EVERY lucide icon, not a hand-listed five.

  The old mock named only the icons this page imports directly, so the first
  child component to use a sixth — CategoryMultiSelect wants ChevronDown and
  Search — received `undefined` and React threw "Element type is invalid". The
  suite had been failing 6/6 for that reason alone.

  A Proxy means adding an icon anywhere in the tree can never break this again.
*/
jest.mock('lucide-react', () => {
  const React = jest.requireActual('react');
  return new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === '__esModule') return true;
        const Icon = () => React.createElement('span', { 'data-testid': `icon-${String(name)}` }, String(name));
        Icon.displayName = String(name);
        return Icon;
      },
    },
  );
});

// The description is a rich-text editor; a plain textarea stands in for it so the
// test can type into it without a contenteditable implementation in jsdom.
jest.mock('@/components/ui/RichTextEditor', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (html: string) => void }) => (
    <textarea aria-label="Description" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// The page saves via a raw multipart POST (submitMultipart); stub only that call
// and keep the real response parsing.
const mockSubmitMultipart = jest.fn();
jest.mock('@/lib/multipartResponse', () => ({
  ...jest.requireActual('@/lib/multipartResponse'),
  submitMultipart: (...args: unknown[]) => mockSubmitMultipart(...args),
}));

// Homepage ISR revalidation is fire-and-forget; keep it off the network.
jest.mock('@/lib/revalidateHome', () => ({ revalidateHome: jest.fn() }));

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
      // The fitment picker reads the UNCACHED admin list, not the public
      // '/vehicles' — a public, browser-cacheable response hid newly created
      // vehicles from the editor for up to 30 minutes.
      if (url === '/vehicles/admin/list') {
        return Promise.resolve({ vehicles: mockVehicles });
      }
      return Promise.resolve({});
    });
    
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });
    mockSubmitMultipart.mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ success: true }),
    });
    window.alert = jest.fn();
  });

  it('renders form after fetching data', async () => {
    renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Product Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Categories')).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Test Description' } });
    fireEvent.change(screen.getByLabelText(/Price/i), { target: { value: '100' } });
    // Stock is the coarse in/low/out enum, not a quantity.
    fireEvent.change(screen.getByLabelText(/Stock Status/i), { target: { value: 'low' } });

    const submitButton = screen.getByRole('button', { name: /Create Product/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Product created successfully');
    });

    expect(mockSubmitMultipart).toHaveBeenCalledWith('/api/v1/products', 'POST', expect.any(FormData));
    const form = mockSubmitMultipart.mock.calls[0][2] as FormData;
    expect(form.get('name')).toBe('Test Product');
    expect(form.get('description')).toBe('Test Description');
    expect(form.get('price')).toBe('100');
    expect(form.get('stock')).toBe('low');
    expect(form.get('isActive')).toBe('true');
    expect(mockPush).toHaveBeenCalledWith('/admin/products');
  });

  it('handles dynamic features', async () => {
    renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByText('Add Feature')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Feature'));
    
    const featureInputs = screen.getAllByPlaceholderText(/Advanced Foam Cell Technology/);
    expect(featureInputs).toHaveLength(2); // Initial 1 + Added 1

    fireEvent.change(featureInputs[1], { target: { value: 'New Feature' } });
    expect(featureInputs[1]).toHaveValue('New Feature');
  });

  it('handles image selection', async () => {
    const { container } = renderWithClient(<CreateProductPage />);

    await waitFor(() => {
      expect(screen.getByText('Upload product images')).toBeInTheDocument();
    });

    const file = new File(['(⌐□_□)'], 'chucknorris.png', { type: 'image/png' });
    // ImageUploader's file input is visually hidden behind a drop zone.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });
});
