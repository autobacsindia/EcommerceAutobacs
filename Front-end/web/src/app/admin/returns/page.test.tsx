import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminReturnsPage from './page';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock apiClient
jest.mock('@/lib/api');

// Mock icons
jest.mock('lucide-react', () => ({
  Search: () => <span data-testid="icon-search">Search</span>,
  Eye: () => <span data-testid="icon-eye">Eye</span>,
  Check: () => <span data-testid="icon-check">Check</span>,
  X: () => <span data-testid="icon-x">X</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
  RefreshCw: () => <span data-testid="icon-refresh">Refresh</span>,
  Video: () => <span data-testid="icon-video">Video</span>,
  Image: () => <span data-testid="icon-image">Image</span>,
  ExternalLink: () => <span data-testid="icon-link">Link</span>,
  AlertCircle: () => <span data-testid="icon-alert">Alert</span>,
}));

describe('AdminReturnsPage', () => {
  const mockReturns = [
    {
      _id: 'req1',
      order: { _id: 'ord1' },
      type: 'return',
      refundMethod: 'original_payment',
      refundAmount: 100,
      items: [
        {
          product: { name: 'Product 1', images: [{ url: 'img1.jpg' }] },
          quantity: 1,
          reason: 'defective',
          condition: 'opened',
        },
      ],
      status: 'pending',
      createdAt: '2023-01-01T00:00:00Z',
      timeline: [],
    },
    {
      _id: 'req2',
      order: { _id: 'ord2' },
      type: 'exchange',
      refundMethod: 'store_credit',
      refundAmount: 200,
      items: [
        {
          product: { name: 'Product 2', images: [] },
          quantity: 2,
          reason: 'wrong_item',
          condition: 'sealed',
        },
      ],
      status: 'approved',
      createdAt: '2023-01-02T00:00:00Z',
      timeline: [],
    },
  ];

  const mockResponse = {
    requests: mockReturns,
    pagination: {
      currentPage: 1,
      totalPages: 2,
    },
    count: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue(mockResponse);
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    window.confirm = jest.fn().mockReturnValue(true);
    window.prompt = jest.fn().mockReturnValue('Rejection reason');
    window.alert = jest.fn();
  });

  it('renders returns list', async () => {
    render(<AdminReturnsPage />);

    await waitFor(() => {
      expect(screen.getByText('REQ: REQ1')).toBeInTheDocument();
      expect(screen.getByText('ORD: ORD1')).toBeInTheDocument();
      expect(screen.getByText('defective')).toBeInTheDocument();
      expect(screen.getByText('PENDING')).toBeInTheDocument();

      expect(screen.getByText('REQ: REQ2')).toBeInTheDocument();
      expect(screen.getByText('ORD: ORD2')).toBeInTheDocument();
      expect(screen.getByText('wrong item')).toBeInTheDocument(); // replace('_', ' ')
      expect(screen.getByText('APPROVED')).toBeInTheDocument();
    });
  });

  it('handles filtering', async () => {
    render(<AdminReturnsPage />);

    await waitFor(() => {
      expect(screen.getByText('REQ: REQ1')).toBeInTheDocument();
    });

    const filterSelect = screen.getByRole('combobox');
    fireEvent.change(filterSelect, { target: { value: 'pending' } });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('status=pending'));
    });
  });

  it('handles client-side search', async () => {
    render(<AdminReturnsPage />);

    await waitFor(() => {
      expect(screen.getByText('REQ: REQ1')).toBeInTheDocument();
      expect(screen.getByText('REQ: REQ2')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search by order ID...');
    fireEvent.change(searchInput, { target: { value: 'ord1' } });

    expect(screen.getByText('REQ: REQ1')).toBeInTheDocument();
    expect(screen.queryByText('REQ: REQ2')).not.toBeInTheDocument();
  });

  it('handles pagination', async () => {
    render(<AdminReturnsPage />);

    await waitFor(() => {
      expect(screen.getByText('Next')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('page=2'));
    });
  });

  it('handles approve return', async () => {
    render(<AdminReturnsPage />);

    await waitFor(() => {
      expect(screen.getByTitle('Approve')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Approve'));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        expect.stringContaining('/returns/req1/status'),
        expect.objectContaining({ status: 'approved' })
      );
    });
  });

  it('handles reject return', async () => {
    render(<AdminReturnsPage />);

    await waitFor(() => {
      expect(screen.getByTitle('Reject')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Reject'));

    expect(window.prompt).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        expect.stringContaining('/returns/req1/status'),
        expect.objectContaining({ status: 'rejected', rejectionReason: 'Rejection reason' })
      );
    });
  });

  it('handles view details', async () => {
    render(<AdminReturnsPage />);

    await waitFor(() => {
      const viewButtons = screen.getAllByTitle('View Details');
      fireEvent.click(viewButtons[0]);
    });

    expect(screen.getByText('Request Details #REQ1')).toBeInTheDocument();
    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.getByText('Condition: opened')).toBeInTheDocument();
  });
});
