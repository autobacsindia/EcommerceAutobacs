import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateCategoryPage from './page';
import apiClient from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Upload: () => <span data-testid="icon-upload">Upload</span>,
  // Icons used by the embedded <SeoPanel>.
  Search: () => <span data-testid="icon-search">Search</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">ChevronDown</span>,
  ChevronRight: () => <span data-testid="icon-chevron-right">ChevronRight</span>,
  Info: () => <span data-testid="icon-info">Info</span>,
}));

// Helper to drive the ?parent= query param the page reads.
const mockSearchParams = (parent: string | null) => {
  (useSearchParams as jest.Mock).mockReturnValue({
    get: (key: string) => (key === 'parent' ? parent : null),
  });
};

describe('CreateCategoryPage', () => {
  const mockRouter = {
    back: jest.fn(),
    push: jest.fn(),
    refresh: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    mockSearchParams(null); // hub mode by default
    (apiClient.get as jest.Mock).mockResolvedValue({ category: { _id: 'hub1', name: 'Body Kits' } });

    // The form submits a multipart request via raw fetch (so the image file is
    // actually uploaded), not apiClient.post.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => JSON.stringify({ success: true }),
    }) as jest.Mock;

    // Mock URL.createObjectURL / revokeObjectURL
    global.URL.createObjectURL = jest.fn(() => 'blob:http://localhost:3000/test-blob');
    global.URL.revokeObjectURL = jest.fn();
  });

  describe('hub mode (no ?parent)', () => {
    it('renders form elements without a parent selector', async () => {
      render(<CreateCategoryPage />);

      await waitFor(() => {
        expect(screen.getByLabelText(/^Name/i)).toBeInTheDocument(); // ^Name to match "Name *"
      });
      expect(screen.getByLabelText(/^Slug/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Category Image/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Order/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Active/i)).toBeInTheDocument();
      // No parent field in hub mode; featured is offered for hubs.
      expect(screen.queryByText(/Parent hub/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText(/Featured/i)).toBeInTheDocument();
      // No parent hub needs to be fetched in hub mode.
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('handles validation errors', async () => {
      render(<CreateCategoryPage />);

      const submitButton = await screen.findByRole('button', { name: /Create Category/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/Category name is required/i)).toBeInTheDocument();
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('submits a top-level hub (no parent) with valid data', async () => {
      render(<CreateCategoryPage />);

      fireEvent.change(await screen.findByLabelText(/^Name/i), { target: { value: 'New Category' } });
      fireEvent.change(screen.getByLabelText(/^Slug/i), { target: { value: 'new-category' } });
      fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Test Description' } });
      fireEvent.change(screen.getByLabelText(/Order/i), { target: { value: '10' } });

      fireEvent.click(screen.getByRole('button', { name: /Create Category/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/v1/categories', expect.objectContaining({ method: 'POST' }));
      });

      const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData;
      expect(body.get('name')).toBe('New Category');
      expect(body.get('slug')).toBe('new-category');
      expect(body.get('description')).toBe('Test Description');
      expect(body.get('order')).toBe('10');
      expect(body.get('isActive')).toBe('true');
      // Hub mode never sends a parent.
      expect(body.get('parent')).toBeNull();

      expect(mockRouter.push).toHaveBeenCalledWith('/admin/categories');
    });
  });

  describe('subcategory mode (?parent=hub1)', () => {
    beforeEach(() => {
      mockSearchParams('hub1');
    });

    it('resolves the parent hub and shows it read-only', async () => {
      render(<CreateCategoryPage />);

      await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalledWith('/categories/hub1');
      });
      // Parent hub label appears; there is no free-form parent dropdown.
      expect(await screen.findByText(/Parent hub/i)).toBeInTheDocument();
      expect(screen.getAllByText('Body Kits').length).toBeGreaterThan(0);
      // Featured is hidden for subcategories.
      expect(screen.queryByLabelText(/Featured/i)).not.toBeInTheDocument();
    });

    it('submits with the locked parent and returns to the hub page', async () => {
      render(<CreateCategoryPage />);

      await screen.findByText(/Parent hub/i);
      fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Front Bumpers' } });
      fireEvent.change(screen.getByLabelText(/^Slug/i), { target: { value: 'front-bumpers' } });

      fireEvent.click(screen.getByRole('button', { name: /Create Subcategory/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData;
      expect(body.get('parent')).toBe('hub1');
      expect(body.get('isFeatured')).toBe('false');

      expect(mockRouter.push).toHaveBeenCalledWith('/admin/categories/hub1');
    });
  });

  it('handles image upload preview', async () => {
    render(<CreateCategoryPage />);

    const input = await screen.findByLabelText(/Category Image/i);
    const file = new File(['(⌐□_□)'], 'chucknorris.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(file);
      expect(screen.getByAltText('Preview')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Image Alt Text/i)).toBeInTheDocument();
  });

  it('handles API error on submission', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'API Error' }),
      text: async () => JSON.stringify({ message: 'API Error' }),
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<CreateCategoryPage />);

    fireEvent.change(await screen.findByLabelText(/^Name/i), { target: { value: 'New Category' } });
    fireEvent.change(screen.getByLabelText(/^Slug/i), { target: { value: 'new-category' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Category/i }));

    await waitFor(() => {
      expect(screen.getByText(/API Error/i)).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });
});
