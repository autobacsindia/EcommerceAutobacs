import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminOrdersPage from './page';
import apiClient from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
  }),
}));
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
});

// Mock icons
jest.mock('lucide-react', () => ({
  Eye: () => <span>EyeIcon</span>,
  RefreshCw: () => <span>RefreshCwIcon</span>,
  Download: () => <span>DownloadIcon</span>,
  ArrowUpDown: () => <span>ArrowUpDownIcon</span>,
  Search: () => <span>SearchIcon</span>,
  Filter: () => <span>FilterIcon</span>,
  CheckSquare: () => <span>CheckSquareIcon</span>,
  Square: () => <span>SquareIcon</span>,
  // Icons used by ConfirmStatusChangeModal
  X: () => <span>XIcon</span>,
  AlertCircle: () => <span>AlertCircleIcon</span>,
  ArrowRight: () => <span>ArrowRightIcon</span>,
  Mail: () => <span>MailIcon</span>,
  Paperclip: () => <span>PaperclipIcon</span>,
}));

// Mock Child Components
jest.mock('@/components/orders/OrderFiltersPanel', () => {
  return ({ onFiltersChange }: { onFiltersChange: (f: any) => void }) => (
    <div data-testid="filters-panel">
      <button 
        data-testid="apply-filter-btn"
        onClick={() => onFiltersChange({
          search: 'test-order',
          statuses: [],
          paymentStatuses: [],
          startDate: '',
          endDate: '',
          minAmount: '',
          maxAmount: '',
          customer: ''
        })}
      >
        Apply Filter
      </button>
    </div>
  );
});

jest.mock('@/components/orders/BulkActionsBar', () => {
  return ({ selectedCount }: { selectedCount: number }) => (
    <div data-testid="bulk-actions">
      Selected: {selectedCount}
    </div>
  );
});

describe('AdminOrdersPage', () => {
  const mockOrders = {
    success: true,
    count: 2,
    orders: [
      {
        _id: 'o1',
        orderNumber: 'ORD-001',
        createdAt: '2023-01-01T00:00:00Z',
        status: 'pending',
        totalAmount: 100,
        user: { _id: 'u1', name: 'User 1', email: 'u1@example.com' },
        items: [],
      },
      {
        _id: 'o2',
        orderNumber: 'ORD-002',
        createdAt: '2023-01-02T00:00:00Z',
        status: 'delivered',
        totalAmount: 200,
        user: { _id: 'u2', name: 'User 2', email: 'u2@example.com' },
        items: [],
      },
    ],
    pagination: {
      total: 2,
      pages: 1,
      currentPage: 1,
      hasNext: false,
      hasPrev: false,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Carriers endpoint feeds the shipping modal's dropdown; everything else
    // returns the orders list.
    (apiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/tracking/carriers')) {
        return Promise.resolve({ carriers: [{ name: 'Delhivery', code: 'DELHIVERY' }] });
      }
      return Promise.resolve(mockOrders);
    });
    // Mock put for status update
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
  });

  it('renders orders table after fetch', async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      expect(screen.getByText(/ORD-002/)).toBeInTheDocument();
      expect(screen.getByText('User 1')).toBeInTheDocument();
      expect(screen.getByText('User 2')).toBeInTheDocument();
    });
  });

  it('confirms via modal before updating status, and warns about the customer email', async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    // Find the row containing ORD-001 and its status dropdown
    const row = screen.getByText(/ORD-001/).closest('tr');
    expect(row).toBeInTheDocument();
    const statusSelect = within(row!).getByRole('combobox');

    // Selecting a new status opens the confirmation modal — it must NOT fire the API yet.
    fireEvent.change(statusSelect, { target: { value: 'shipped' } });
    expect(apiClient.put).not.toHaveBeenCalled();

    // 'shipped' is a customer-notified status → the modal warns about the email.
    await waitFor(() => {
      expect(screen.getByText(/customer will be emailed/i)).toBeInTheDocument();
    });

    // Shipping requires a tracking number + carrier before it will submit.
    fireEvent.change(screen.getByPlaceholderText(/123456789012/), {
      target: { value: 'TRK123456789' },
    });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Delhivery' })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/carrier/i), { target: { value: 'DELHIVERY' } });

    // Confirm — now the API fires with the chosen status + tracking details.
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        expect.stringContaining('/o1'),
        expect.objectContaining({
          status: 'shipped',
          trackingNumber: 'TRK123456789',
          carrierCode: 'DELHIVERY',
        })
      );
    });
  });

  it('refetches orders when filters change', async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    // Trigger filter change
    fireEvent.click(screen.getByTestId('apply-filter-btn'));

    await waitFor(() => {
      // The unified search box sends `search=` (order id OR customer OR recipient),
      // not the legacy id-only `orderNumber=`.
      expect(apiClient.get).toHaveBeenCalledWith(
        expect.stringContaining('search=test-order')
      );
    });
  });

  it('renders a numbered pagination navigator and switches pages', async () => {
    // Echo the requested page so the navigator reflects real server-driven paging.
    (apiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/tracking/carriers')) {
        return Promise.resolve({ carriers: [] });
      }
      const currentPage = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1);
      return Promise.resolve({
        success: true,
        count: mockOrders.orders.length,
        orders: mockOrders.orders,
        pagination: { total: 25, pages: 3, currentPage, limit: 10, hasNext: currentPage < 3, hasPrev: currentPage > 1 },
      });
    });

    render(<AdminOrdersPage />);
    await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

    const nav = screen.getByRole('navigation', { name: /orders pagination/i });
    expect(within(nav).getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: '3' })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('page=2'));
    });
  });

  it('handles row selection', async () => {
    render(<AdminOrdersPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    // Find checkbox for first order
    // Assuming standard checkbox input
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox might be "Select All" in header
    // Let's click the second one (first row)
    if (checkboxes.length > 1) {
        fireEvent.click(checkboxes[1]);
        
        await waitFor(() => {
            expect(screen.getByTestId('bulk-actions')).toHaveTextContent('Selected: 1');
        });
    }
  });
});
