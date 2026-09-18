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
  X: () => <span data-testid="icon-x">X</span>,
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

  /*
    Search is SERVER-SIDE as of the 2026-09 optimisation pass.

    It used to filter a fully-loaded list in the browser, and this test asserted that.
    That only worked because the endpoint returned every matching order; once the query
    was bounded to a page, client-side filtering would have silently become "search
    within the rows you happen to have loaded" — which looks like working search while
    hiding results. So the contract under test changed deliberately, and the assertion
    moved with it: the term must reach the server.
  */
  it('sends the search term to the server rather than filtering locally', async () => {
    render(<AdminRefundsPage />);

    await waitFor(() => {
      expect(screen.getByText('#ORD-001')).toBeInTheDocument();
    });

    (apiClient.get as jest.Mock).mockClear();
    fireEvent.change(screen.getByPlaceholderText('Search by order or customer...'), {
      target: { value: 'Priya' },
    });

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('search=Priya'));
    });

    // Both rows are still shown: what comes back is the server's answer, and this screen
    // no longer second-guesses it.
    expect(screen.getByText('#ORD-001')).toBeInTheDocument();
  });

  it('requests a bounded page', async () => {
    // The unbounded form was a latent outage, not just slow: a collection scan feeding an
    // in-memory sort, which MongoDB aborts above 32 MB.
    render(<AdminRefundsPage />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('limit=50')));
  });

  it('pages with the cursor the server handed back, and appends', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      refunds: [mockRefunds[0]],
      nextCursor: { createdAt: '2026-09-01T00:00:00.000Z', id: 'o1' },
    });
    render(<AdminRefundsPage />);

    const loadMore = await screen.findByRole('button', { name: /Load more/ });
    (apiClient.get as jest.Mock).mockResolvedValueOnce({ refunds: [mockRefunds[1]], nextCursor: null });
    fireEvent.click(loadMore);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('cursorId=o1'));
    });
    // Appended, not replaced — paging must not throw away the rows already on screen.
    await waitFor(() => {
      expect(screen.getByText('#ORD-001')).toBeInTheDocument();
      expect(screen.getByText('#ORD-002')).toBeInTheDocument();
    });
    // Last page: nothing more to offer.
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
  });

  it('offers no "Load more" when the server reports no next page', async () => {
    render(<AdminRefundsPage />);
    await waitFor(() => expect(screen.getByText('#ORD-001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
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

/**
 * Regressions from the 2026-09 code review.
 */
describe('AdminRefundsPage — review regressions', () => {
  // Its own fixture + beforeEach: this block is a sibling of the suite above, so it does
  // not inherit that one's mock setup.
  const pendingRefund = {
    _id: 'r1',
    order: { _id: 'o1', orderNumber: 'ORD-001' },
    user: { name: 'User 1' },
    amount: 1000,
    refundType: 'full',
    refundMethod: 'original_payment',
    status: 'pending',
    requestedAt: '2026-09-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.get as jest.Mock).mockResolvedValue({ refunds: [pendingRefund] });
  });

  const completedOffline = {
    _id: 'r9',
    order: { _id: 'o9', orderNumber: 'ORD-009' },
    user: { name: 'User 9' },
    amount: 1500,
    refundType: 'full',
    refundMethod: 'offline',
    offlineMethod: 'bank_transfer',
    offlineReference: 'UTR-991',
    status: 'completed',
    requestedAt: '2026-09-10T00:00:00Z',
  };

  it('offers Revert for a genuinely offline record', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ refunds: [completedOffline] });
    render(<AdminRefundsPage />);
    expect(await screen.findByRole('button', { name: /Revert/ })).toBeInTheDocument();
  });

  it('does NOT offer Revert for a RETURN-sourced mirror', async () => {
    /*
      REGRESSION. A return's offline refund mirrors onto the order with
      `refundMethod: 'offline'` but never sets `offlineMethod` (its reference lives in
      `transactionId`). `claimRefundRevert` excludes those mirrors by their `Return <id>`
      note, so gating on `refundMethod` alone offered a button that ALWAYS 409'd with a
      message contradicting the row it sat on.
    */
    (apiClient.get as jest.Mock).mockResolvedValue({
      refunds: [{ ...completedOffline, offlineMethod: null, offlineReference: null }],
    });
    render(<AdminRefundsPage />);

    await screen.findByText('#ORD-009');
    expect(screen.queryByRole('button', { name: /Revert/ })).not.toBeInTheDocument();
  });

  it('keeps the search input mounted and focused across a debounced refetch', async () => {
    /*
      REGRESSION. `loading` drives a full-page replacement, and it was being set on every
      refetch — so each debounced search unmounted the <input> mid-keystroke and threw
      focus to the body. The admin typed two characters and was then typing into nothing.
    */
    render(<AdminRefundsPage />);
    await waitFor(() => expect(screen.getByText('#ORD-001')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('Search by order or customer...') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'Pri' } });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('search=Pri')));

    expect(screen.queryByText('Loading refunds...')).not.toBeInTheDocument();
    // Same element instance, still focused — not a remount.
    expect(screen.getByPlaceholderText('Search by order or customer...')).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it('still shows the full-page loader on the FIRST load only', async () => {
    render(<AdminRefundsPage />);
    expect(screen.getByText('Loading refunds...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('#ORD-001')).toBeInTheDocument());
  });
});
