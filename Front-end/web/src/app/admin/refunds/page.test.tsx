import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminRefundsPage from './page';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

// Mock apiClient
jest.mock('@/lib/api');

// Mock icons
jest.mock('lucide-react', () => ({
  Search: () => <span data-testid="icon-search">Search</span>,
  DollarSign: () => <span data-testid="icon-dollar">Dollar</span>,
  Eye: () => <span data-testid="icon-eye">Eye</span>,
}));

describe('AdminRefundsPage', () => {
  const mockRefunds = [
    {
      _id: 'r1',
      order: { _id: 'o1', orderNumber: 'ORD-001' },
      user: { name: 'User 1' },
      amount: 1000,
      refundType: 'full_refund',
      refundMethod: 'bank_transfer',
      status: 'pending',
      requestedAt: '2023-01-01T00:00:00Z',
    },
    {
      _id: 'r2',
      order: { _id: 'o2', orderNumber: 'ORD-002' },
      user: { name: 'User 2' },
      amount: 500,
      refundType: 'partial_refund',
      refundMethod: 'wallet',
      status: 'completed',
      requestedAt: '2023-01-02T00:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue({
      refunds: mockRefunds
    });
  });

  it('renders refunds list', async () => {
    render(<AdminRefundsPage />);

    expect(screen.getByText('Loading refunds...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Refunds Management')).toBeInTheDocument();
      expect(screen.getByText('#ORD-001')).toBeInTheDocument();
      expect(screen.getByText('User 1')).toBeInTheDocument();
      expect(screen.getByText('pending')).toBeInTheDocument();
      
      expect(screen.getByText('#ORD-002')).toBeInTheDocument();
      expect(screen.getByText('User 2')).toBeInTheDocument();
      expect(screen.getByText('completed')).toBeInTheDocument();
    });
  });

  it('handles filtering by status', async () => {
    render(<AdminRefundsPage />);

    await waitFor(() => {
      expect(screen.getByText('Refunds Management')).toBeInTheDocument();
    });

    const filterSelect = screen.getByRole('combobox');
    fireEvent.change(filterSelect, { target: { value: 'pending' } });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('status=pending'));
    });
  });

  it('handles client-side search', async () => {
    render(<AdminRefundsPage />);

    await waitFor(() => {
      expect(screen.getByText('#ORD-001')).toBeInTheDocument();
      expect(screen.getByText('#ORD-002')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search by order or customer...');
    fireEvent.change(searchInput, { target: { value: 'ORD-001' } });

    expect(screen.getByText('#ORD-001')).toBeInTheDocument();
    expect(screen.queryByText('#ORD-002')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'User 2' } });
    expect(screen.queryByText('#ORD-001')).not.toBeInTheDocument();
    expect(screen.getByText('#ORD-002')).toBeInTheDocument();
  });

  it('handles empty state', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ refunds: [] });

    render(<AdminRefundsPage />);

    await waitFor(() => {
      expect(screen.getByText('No refunds found')).toBeInTheDocument();
    });
  });

  it('handles API error', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('API Error'));

    render(<AdminRefundsPage />);

    await waitFor(() => {
      expect(screen.getByText('Refunds Management')).toBeInTheDocument();
    });
    
    expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch refunds:', expect.any(Error));
    consoleSpy.mockRestore();
  });
});
