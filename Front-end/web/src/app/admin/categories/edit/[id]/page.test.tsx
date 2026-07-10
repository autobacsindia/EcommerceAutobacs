import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditCategoryPage from './page';
import apiClient from '@/lib/api';
import { useRouter, useParams } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(),
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

describe('EditCategoryPage', () => {
  const mockRouter = {
    back: jest.fn(),
    push: jest.fn(),
    refresh: jest.fn(),
  };

  const mockCategory = {
    _id: 'c1',
    name: 'Existing Category',
    slug: 'existing-category',
    description: 'Existing Description',
    parent: { _id: 'p1', name: 'Parent Cat' },
    image: { url: 'http://example.com/img.jpg', alt: 'Existing Image' },
    isActive: true,
    order: 5,
  };

  const mockCategories = [
    { _id: 'p1', name: 'Parent Cat' },
    { _id: 'c1', name: 'Existing Category' }, // Should be filtered out from parent options
    { _id: 'c2', name: 'Other Category' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useParams as jest.Mock).mockReturnValue({ id: 'c1' });
    
    // Mock get all categories (for parent dropdown)
    // and get specific category
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url === '/categories/admin/all?counts=false') {
        return Promise.resolve({ data: mockCategories });
      }
      if (url === '/categories/c1') {
        return Promise.resolve({ category: mockCategory });
      }
      return Promise.reject(new Error(`Not found: ${url}`));
    });

    // Updates submit via raw fetch (multipart) so a new image file is uploaded.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as jest.Mock;

    global.URL.createObjectURL = jest.fn(() => 'blob:http://localhost:3000/test-blob');
    global.URL.revokeObjectURL = jest.fn();
  });

  it('renders loading state initially', async () => {
    render(<EditCategoryPage />);
    expect(screen.queryByLabelText(/^Name/i)).not.toBeInTheDocument();
    
    // Wait for data load to complete to avoid act() warnings
    await waitFor(() => {
      expect(screen.queryByLabelText(/^Name/i)).toBeInTheDocument();
    });
  });

  it('fetches and populates category data', async () => {
    render(<EditCategoryPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Name/i)).toHaveValue('Existing Category');
      expect(screen.getByLabelText(/^Slug/i)).toHaveValue('existing-category');
      expect(screen.getByLabelText(/Description/i)).toHaveValue('Existing Description');
      expect(screen.getByLabelText(/Order/i)).toHaveValue(5);
      expect(screen.getByLabelText(/Image Alt Text/i)).toHaveValue('Existing Image');
    });

    // A category WITH a parent is a subcategory -> shows the hub-only selector.
    const parentSelect = await screen.findByLabelText(/Parent hub/i);
    expect(parentSelect).toHaveValue('p1');
    
    // Check that own category is not in parent options
    // Note: 'Existing Category' is the name of the current category (c1).
    // The dropdown options render the name.
    // However, the component filters out the current category from options.
    // So 'Existing Category' should NOT be an option.
    // But 'Existing Category' is also in the Name input value, so getByText might find that.
    // We should check that there is no OPTION with that text.
    const options = screen.getAllByRole('option');
    const optionTexts = options.map((opt: any) => opt.textContent);
    expect(optionTexts).not.toContain('Existing Category');
    expect(optionTexts).toContain('Parent Cat');
    expect(optionTexts).toContain('Other Category');
  });

  it('hides the parent selector when editing a top-level hub', async () => {
    // A category with no parent is a hub: no parent selector, featured is offered.
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url === '/categories/admin/all?counts=false') return Promise.resolve({ data: mockCategories });
      if (url === '/categories/c1') {
        return Promise.resolve({ category: { ...mockCategory, parent: null } });
      }
      return Promise.reject(new Error(`Not found: ${url}`));
    });

    render(<EditCategoryPage />);

    await waitFor(() => expect(screen.getByLabelText(/^Name/i)).toHaveValue('Existing Category'));

    expect(screen.queryByLabelText(/Parent hub/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Top-level hub/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Featured/i)).toBeInTheDocument();
  });

  it('updates category successfully', async () => {
    render(<EditCategoryPage />);

    await waitFor(() => expect(screen.getByLabelText(/^Name/i)).toHaveValue('Existing Category'));

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Updated Name' } });
    fireEvent.change(screen.getByLabelText(/Order/i), { target: { value: '10' } });

    const submitButton = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/categories/c1', expect.objectContaining({ method: 'PUT' }));
    });

    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData;
    expect(body.get('name')).toBe('Updated Name');
    expect(body.get('order')).toBe('10');

    expect(mockRouter.push).toHaveBeenCalledWith('/admin/categories');
  });

  it('handles error when fetching category fails', async () => {
    (apiClient.get as jest.Mock).mockImplementation((url) => {
      if (url === '/categories/c1') {
        return Promise.reject(new Error('Fetch Error'));
      }
      return Promise.resolve({ data: [] });
    });
    
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<EditCategoryPage />);

    await waitFor(() => {
      expect(screen.getByText(/Fetch Error/i)).toBeInTheDocument();
    });
    
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
    
    consoleSpy.mockRestore();
  });
});
