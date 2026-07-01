import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminCategoriesPage from './page';
import apiClient from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/api');

// Mock icons
jest.mock('lucide-react', () => ({
  Plus: () => <span data-testid="icon-plus">Plus</span>,
  Edit: () => <span data-testid="icon-edit">Edit</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  FolderOpen: () => <span data-testid="icon-folder-open">FolderOpen</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
  Star: () => <span data-testid="icon-star">Star</span>,
}));

describe('AdminCategoriesPage', () => {
  const mockCategories = [
    {
      _id: 'c1',
      name: 'Category 1',
      slug: 'category-1',
      description: 'Description 1',
      isActive: true,
      order: 1,
      image: { url: 'http://example.com/img1.jpg', alt: 'Img 1' }
    },
    {
      _id: 'c2',
      name: 'Suspension',
      slug: 'suspension',
      description: 'Description 2',
      isActive: false, // inactive category is visible via the admin/all endpoint
      order: 2,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock successful fetch by default
    (apiClient.get as jest.Mock).mockResolvedValue({ data: mockCategories });
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    
    // Mock window.confirm and alert
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('renders loading state initially', async () => {
    // Delay resolution to check loading state
    (apiClient.get as jest.Mock).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: mockCategories }), 100)));
    
    render(<AdminCategoriesPage />);
    
    // Check for skeleton or loading text/structure
    // The component uses a skeleton loader (animate-pulse)
    // We can check for the title "Categories" which is present in loading state
    expect(screen.getByText('Categories')).toBeInTheDocument();
    
    // Wait for the promise to resolve to avoid act warnings
    await waitFor(() => {
        expect(apiClient.get).toHaveBeenCalled();
    });
  });

  it('renders categories after fetch', async () => {
    render(<AdminCategoriesPage />);

    await waitFor(() => {
      expect(screen.getByText('Category 1')).toBeInTheDocument();
      // Category name renders verbatim (no display kludge).
      expect(screen.getByText('Suspension')).toBeInTheDocument();
      expect(screen.getByText('Description 1')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
  });

  it('handles error state', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('Fetch failed'));

    render(<AdminCategoriesPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load categories. Please try again later.')).toBeInTheDocument();
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });
    
    consoleSpy.mockRestore();
  });

  it('handles delete category', async () => {
    render(<AdminCategoriesPage />);

    await waitFor(() => {
      expect(screen.getByText('Category 1')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/categories/c1');
      // It refetches after delete
      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });
  });

  it('renders empty state when no categories found', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: [] });

    render(<AdminCategoriesPage />);

    await waitFor(() => {
      expect(screen.getByText('No categories found')).toBeInTheDocument();
      expect(screen.getByText('Get started by creating a new category.')).toBeInTheDocument();
    });
  });
});
