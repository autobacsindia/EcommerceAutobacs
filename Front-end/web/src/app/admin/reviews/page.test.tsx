import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminReviewsPage from './page';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

// Mock apiClient
jest.mock('@/lib/api');

// Mock useAuth
jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// Mock useRouter
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock icons
jest.mock('lucide-react', () => ({
  CheckCircle: () => <span data-testid="icon-check-circle">CheckCircle</span>,
  XCircle: () => <span data-testid="icon-x-circle">XCircle</span>,
  Trash2: () => <span data-testid="icon-trash">Trash2</span>,
  Eye: () => <span data-testid="icon-eye">Eye</span>,
  Filter: () => <span data-testid="icon-filter">Filter</span>,
  Search: () => <span data-testid="icon-search">Search</span>,
}));

describe('AdminReviewsPage', () => {
  const mockPush = jest.fn();
  const mockReviews = [
    {
      _id: 'rev1',
      product: { _id: 'prod1', name: 'Product 1' },
      user: { _id: 'user1', name: 'User 1', email: 'user1@example.com' },
      rating: 5,
      title: 'Great product',
      comment: 'Loved it!',
      isApproved: false,
      createdAt: '2023-01-01T00:00:00Z',
    },
    {
      _id: 'rev2',
      product: { _id: 'prod2', name: 'Product 2' },
      user: { _id: 'user2', name: 'User 2', email: 'user2@example.com' },
      rating: 3,
      title: 'Okay',
      comment: 'It is fine.',
      isApproved: true,
      createdAt: '2023-01-02T00:00:00Z',
    },
  ];

  const mockResponse = {
    reviews: mockReviews,
    pagination: {
      currentPage: 1,
      totalPages: 2,
      totalReviews: 2,
      hasNext: true,
      hasPrev: false,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { role: 'admin' },
    });
    (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('redirects if not authenticated', () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    render(<AdminReviewsPage />);
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('renders reviews list', async () => {
    render(<AdminReviewsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('User 1')).toBeInTheDocument();
      expect(screen.getByText('Great product')).toBeInTheDocument();
      // Use getAllByText for status because it appears in filter options too
      expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);

      expect(screen.getByText('Product 2')).toBeInTheDocument();
      expect(screen.getByText('User 2')).toBeInTheDocument();
      expect(screen.getByText('Okay')).toBeInTheDocument();
      expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    });
  });

  it('handles filtering', async () => {
    render(<AdminReviewsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    const statusSelect = screen.getAllByRole('combobox')[0]; // First select is status
    fireEvent.change(statusSelect, { target: { value: 'approved' } });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('status=approved'));
    });
  });

  it('handles search', async () => {
    render(<AdminReviewsPage />);

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search reviews...');
    fireEvent.change(searchInput, { target: { value: 'Great' } });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('search=Great'));
    });
  });

  it('handles pagination', async () => {
    render(<AdminReviewsPage />);

    await waitFor(() => {
      expect(screen.getByText('Next', { selector: 'button span.sr-only' })).toBeInTheDocument();
    });

    // There are two "Next" buttons (mobile and desktop). We can target one.
    const nextButtons = screen.getAllByText('Next');
    fireEvent.click(nextButtons[0]);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('page=2'));
    });
  });

  it('handles approve review', async () => {
    render(<AdminReviewsPage />);

    await waitFor(() => {
      expect(screen.getByTitle('Approve')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Approve'));

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/reviews/rev1/approve',
        {}
      );
    });
  });

  it('handles reject review', async () => {
    render(<AdminReviewsPage />);

    await waitFor(() => {
      expect(screen.getByTitle('Reject')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Reject'));

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/reviews/rev2/reject',
        {}
      );
    });
  });

  it('handles delete review', async () => {
    render(<AdminReviewsPage />);

    await waitFor(() => {
      const deleteButtons = screen.getAllByTitle('Delete');
      fireEvent.click(deleteButtons[0]);
    });

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/reviews/rev1/admin');
    });
  });

  it('handles empty state', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      reviews: [],
      pagination: {
        currentPage: 1,
        totalPages: 0,
        totalReviews: 0,
        hasNext: false,
        hasPrev: false,
      },
    });

    render(<AdminReviewsPage />);

    await waitFor(() => {
      expect(screen.getByText('No reviews found')).toBeInTheDocument();
    });
  });
});
