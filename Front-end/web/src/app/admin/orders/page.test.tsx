import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminOrdersPage from './page';
import apiClient from '@/lib/api';
import { useSearchParams } from 'next/navigation';

// The page reads orders via TanStack Query, so tests render it in a provider.
const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminOrdersPage />
    </QueryClientProvider>
  );
};

// Mock dependencies
jest.mock('@/lib/api');
// Stable across renders so a test can assert on the navigation itself. The previous
// factory built a fresh jest.fn() per call, so `push` could never be observed.
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    // Filter changes use replace(), not push() — see updateURL in the page.
    replace: mockReplace,
  }),
  // A real URLSearchParams by default: the page reads `.get()` AND `.toString()` when
  // it syncs the page number, and a bare `{ get }` stub silently breaks the latter.
  useSearchParams: jest.fn(() => new URLSearchParams()),
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
    /*
      `clearAllMocks` clears CALLS but not IMPLEMENTATIONS, so a test that points
      useSearchParams at `?page=3` would leak that into every test after it and quietly
      change what the list requests. Re-seed the default explicitly.
    */
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
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
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      expect(screen.getByText(/ORD-002/)).toBeInTheDocument();
      expect(screen.getByText('User 1')).toBeInTheDocument();
      expect(screen.getByText('User 2')).toBeInTheDocument();
    });
  });

  it('confirms via modal before updating status, and warns about the customer email', async () => {
    renderPage();

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

  /*
    ── SHIPPING A MULTI-ITEM ORDER FROM THE LIST ──────────────────────────────────
    This dialog has one tracking field and no way to say what is in the box, so
    confirming it ships every outstanding unit together. That is fine for a one-unit
    order and wrong for a 3-item order where only 2 are in stock. Picking "Shipped"
    on anything splittable therefore hands over to the order's Parcels panel, which
    is the single place parcels are built.
  */
  describe('shipping hand-off to the Parcels panel', () => {
    const multiItemOrder = {
      ...mockOrders.orders[0],
      status: 'processing',
      items: [
        { _id: 'i1', name: 'Wax', quantity: 2 },
        { _id: 'i2', name: 'Polish', quantity: 1 },
      ],
    };

    const serveOrder = (order: Record<string, unknown>) => {
      (apiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/tracking/carriers')) {
          return Promise.resolve({ carriers: [{ name: 'Delhivery', code: 'DELHIVERY' }] });
        }
        return Promise.resolve({ ...mockOrders, count: 1, orders: [order] });
      });
    };

    const pickShipped = async () => {
      const row = screen.getByText(/ORD-001/).closest('tr');
      fireEvent.change(within(row!).getByRole('combobox'), { target: { value: 'shipped' } });
    };

    it('routes a multi-item order to the Parcels panel instead of shipping it in one box', async () => {
      serveOrder(multiItemOrder);
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      await pickShipped();

      expect(mockPush).toHaveBeenCalledWith('/admin/orders/o1?parcel=1');
      // The whole point: no one-box dispatch, and no API call behind the admin's back.
      expect(apiClient.put).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText(/123456789012/)).not.toBeInTheDocument();
    });

    it('treats an order that ALREADY has parcels as splittable, whatever its unit count', async () => {
      serveOrder({
        ...mockOrders.orders[0],
        status: 'processing',
        items: [{ _id: 'i1', name: 'Wax', quantity: 1 }],
        shipments: [{ _id: 's1', status: 'packed', lines: [] }],
      });
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      await pickShipped();

      expect(mockPush).toHaveBeenCalledWith('/admin/orders/o1?parcel=1');
    });

    it('keeps the fast inline dialog for a single-unit order with no parcels', async () => {
      serveOrder({
        ...mockOrders.orders[0],
        status: 'processing',
        items: [{ _id: 'i1', name: 'Wax', quantity: 1 }],
      });
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      await pickShipped();

      expect(mockPush).not.toHaveBeenCalled();
      // There is exactly one honest parcel here, so the dialog cannot be wrong.
      await waitFor(() =>
        expect(screen.getByPlaceholderText(/123456789012/)).toBeInTheDocument());
    });

    /*
      "Shipped" is still offered from `delivered`, `returned` and `cancelled` — the
      dropdown only blocks a CANCEL after delivery. Those orders have nothing left to
      box, and the Parcels panel refuses to open an empty picker, so handing one over
      would be a dead end: no dialog, no toast, no error, click does nothing. The modal
      at least surfaces the server's rejection.
    */
    it.each(['delivered', 'returned', 'cancelled'])(
      'keeps the dialog for a multi-item order in %s, so the rejection is still visible',
      async (status) => {
        serveOrder({ ...multiItemOrder, status });
        renderPage();
        await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

        await pickShipped();

        expect(mockPush).not.toHaveBeenCalled();
        await waitFor(() =>
          expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument());
      });

    it('still hands off from `shipped`, where another parcel is legitimate', async () => {
      serveOrder({
        ...multiItemOrder,
        status: 'shipped',
        shipments: [{ _id: 's1', status: 'shipped', lines: [] }],
      });
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      await pickShipped();

      expect(mockPush).toHaveBeenCalledWith('/admin/orders/o1?parcel=1');
    });

    it('leaves the dropdown reading the order\'s real status after handing off', async () => {
      serveOrder(multiItemOrder);
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      const row = screen.getByText(/ORD-001/).closest('tr');
      const select = within(row!).getByRole('combobox') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'shipped' } });

      // The hand-off changes no state on this page, so nothing would re-render and
      // reset the controlled select — the row would claim "Shipped" for an order
      // that has not shipped.
      expect(select.value).toBe('processing');
    });

    it('still opens the dialog for a NON-shipping status on a multi-item order', async () => {
      serveOrder(multiItemOrder);
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      const row = screen.getByText(/ORD-001/).closest('tr');
      fireEvent.change(within(row!).getByRole('combobox'), { target: { value: 'cancelled' } });

      expect(mockPush).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument());
    });
  });

  /*
    ── THE ADMIN'S PLACE IN THE LIST ──────────────────────────────────────────────
    Filters have always lived in the URL; the page number did not, so coming back to
    this screen always landed on page 1. That is a standing annoyance, and the
    "Shipped" hand-off makes it routine — ship an order on page 7, press Back, and the
    next one is nowhere to be found.
  */
  describe('page number in the URL', () => {
    it('is seeded from ?page on mount', async () => {
      (useSearchParams as jest.Mock).mockReturnValue(
        new URLSearchParams('page=3') as unknown as ReturnType<typeof useSearchParams>);
      renderPage();

      await waitFor(() =>
        expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('page=3')));
    });

    it('stays out of the URL on page 1, so a plain list URL never grows ?page=1', async () => {
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      // Nothing set the page, so nothing should have written it.
      const pageWrites = mockReplace.mock.calls.filter(
        ([url]: [string]) => String(url).includes('page='));
      expect(pageWrites).toHaveLength(0);
    });
  });

  it('refetches orders when filters change', async () => {
    renderPage();

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

    renderPage();
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
    renderPage();

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

  /**
   * Split shipments on the admin list.
   *
   * Two gaps, both from the same root cause: `Order.status` is a roll-up that does not
   * move until the LAST parcel does, so the list could neither SHOW partial progress
   * nor WARN that "Delivered" lands every parcel at once (and emails the customer once
   * per parcel). Shipping from this screen already warned; delivering did not.
   */
  describe('split shipments', () => {
    const withParcels = (shipments: unknown[]) => ({
      ...mockOrders,
      orders: [{ ...mockOrders.orders[0], status: 'shipped', shipments }],
    });

    const serve = (payload: unknown) => {
      (apiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/tracking/carriers')) {
          return Promise.resolve({ carriers: [{ name: 'Delhivery', code: 'DELHIVERY' }] });
        }
        return Promise.resolve(payload);
      });
    };

    it('shows how far a split order has actually got', async () => {
      serve(withParcels([
        { _id: 's1', status: 'delivered', deliveredAt: '2023-01-05T00:00:00Z', lines: [] },
        { _id: 's2', status: 'shipped', lines: [] },
      ]));
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('1 of 2 parcels delivered')).toBeInTheDocument();
      });
    });

    // Without the badge these two rows are indistinguishable — both read "Shipped".
    it('shows nothing extra for a single-parcel order', async () => {
      serve(withParcels([{ _id: 's1', status: 'shipped', lines: [] }]));
      renderPage();

      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());
      expect(screen.queryByText(/parcels/i)).not.toBeInTheDocument();
    });

    it('warns that Delivered lands every outstanding parcel at once', async () => {
      serve(withParcels([
        { _id: 's1', status: 'shipped', lines: [] },
        { _id: 's2', status: 'shipped', lines: [] },
      ]));
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      const row = screen.getByText(/ORD-001/).closest('tr');
      fireEvent.change(within(row!).getByRole('combobox'), { target: { value: 'delivered' } });

      await waitFor(() => {
        expect(screen.getByText(/all 2 parcels/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/once per parcel/i)).toBeInTheDocument();
      // Still a confirmation, not an action: nothing fires until the admin confirms.
      expect(apiClient.put).not.toHaveBeenCalled();
    });

    // Already-delivered parcels are no-ops server-side, so quoting them would overstate
    // what the click actually does.
    it('counts only the parcels still in flight', async () => {
      serve(withParcels([
        { _id: 's1', status: 'delivered', deliveredAt: '2023-01-05T00:00:00Z', lines: [] },
        { _id: 's2', status: 'shipped', lines: [] },
        { _id: 's3', status: 'shipped', lines: [] },
      ]));
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      const row = screen.getByText(/ORD-001/).closest('tr');
      fireEvent.change(within(row!).getByRole('combobox'), { target: { value: 'delivered' } });

      await waitFor(() => {
        expect(screen.getByText(/all 2 parcels/i)).toBeInTheDocument();
      });
    });

    // A legacy order has no parcels at all; the warning would be meaningless.
    it('does not warn for a parcel-less order', async () => {
      serve({ ...mockOrders, orders: [{ ...mockOrders.orders[0], status: 'shipped' }] });
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());

      const row = screen.getByText(/ORD-001/).closest('tr');
      fireEvent.change(within(row!).getByRole('combobox'), { target: { value: 'delivered' } });

      await waitFor(() => {
        expect(screen.getByText(/customer will be emailed/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/parcels/i)).not.toBeInTheDocument();
    });
  });
  /**
   * Part-cancelled orders keep a LIVE status. Without a badge, ops sees `Processing` on an
   * order whose lines were half killed and refunded — identical to an untouched one.
   */
  describe('part-cancelled badge', () => {
    const serveOrders = (payload: unknown) => {
      (apiClient.get as jest.Mock).mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/tracking/carriers')) {
          return Promise.resolve({ carriers: [{ name: 'Delhivery', code: 'DELHIVERY' }] });
        }
        return Promise.resolve(payload);
      });
    };

    it('flags an order that was partly cancelled', async () => {
      serveOrders({
        ...mockOrders,
        orders: [{
          ...mockOrders.orders[0], status: 'processing',
          cancellations: [{ _id: 'c1', lines: [{ itemId: 'i1', quantity: 1 }] }],
        }],
      });
      renderPage();
      await waitFor(() => expect(screen.getByText('Part cancelled')).toBeInTheDocument());
    });

    // A wholly cancelled order already says `Cancelled` in its status control.
    it('does not repeat itself on a wholly cancelled order', async () => {
      serveOrders({
        ...mockOrders,
        orders: [{
          ...mockOrders.orders[0], status: 'cancelled',
          cancellations: [{ _id: 'c1', lines: [{ itemId: 'i1', quantity: 1 }] }],
        }],
      });
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());
      expect(screen.queryByText('Part cancelled')).not.toBeInTheDocument();
    });

    it('shows nothing on an order that was never cancelled', async () => {
      serveOrders(mockOrders);
      renderPage();
      await waitFor(() => expect(screen.getByText(/ORD-001/)).toBeInTheDocument());
      expect(screen.queryByText('Part cancelled')).not.toBeInTheDocument();
    });
  });
});
