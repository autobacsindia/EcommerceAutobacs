import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminOrderDetailPage from './page';
import apiClient from '@/lib/api';
import { useRouter, useParams, useSearchParams } from 'next/navigation';

// Mock dependencies
jest.mock('@/lib/api');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(),
  // Read for the `?parcel=1` hand-off from the orders list.
  useSearchParams: jest.fn(),
}));
jest.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="icon-arrow-left">ArrowLeft</span>,
  Package: () => <span data-testid="icon-package">Package</span>,
  MapPin: () => <span data-testid="icon-map-pin">MapPin</span>,
  CreditCard: () => <span data-testid="icon-credit-card">CreditCard</span>,
  Truck: () => <span data-testid="icon-truck">Truck</span>,
  Download: () => <span data-testid="icon-download">Download</span>,
  // Icons used by ConfirmStatusChangeModal
  X: () => <span>XIcon</span>,
  AlertCircle: () => <span>AlertCircleIcon</span>,
  ArrowRight: () => <span>ArrowRightIcon</span>,
  Mail: () => <span>MailIcon</span>,
  Paperclip: () => <span>PaperclipIcon</span>,
}));

describe('AdminOrderDetailPage', () => {
  const mockRouter = {
    back: jest.fn(),
    push: jest.fn(),
    // The page strips `?parcel=1` once handled, so the one-shot instruction does not
    // survive a reload or a Back into this entry.
    replace: jest.fn(),
  };

  /** Stand-in for Next's ReadonlyURLSearchParams — only `get` is used. */
  const searchParams = (params: Record<string, string> = {}) => ({
    get: (k: string) => params[k] ?? null,
  });

  const mockOrder = {
    _id: 'order123',
    orderNumber: 'ORD-001',
    createdAt: '2023-01-01T12:00:00Z',
    status: 'pending',
    items: [
      {
        product: {
          _id: 'p1',
          name: 'Test Product',
          images: [{ url: 'http://img.com/p1.jpg' }],
        },
        quantity: 2,
        price: 100,
      }
    ],
    shippingAddress: {
      fullName: 'John Doe',
      phone: '1234567890',
      addressLine1: '123 Main St',
      city: 'City',
      state: 'State',
      postalCode: '12345',
      country: 'Country',
    },
    subtotal: 200,
    shippingCost: 50,
    tax: 20,
    discount: 0,
    totalAmount: 270,
    user: {
      _id: 'u1',
      name: 'User Name',
      email: 'user@example.com',
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useParams as jest.Mock).mockReturnValue({ id: 'order123' });
    (useSearchParams as jest.Mock).mockReturnValue(searchParams());
    (apiClient.get as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/tracking/carriers')) {
        return Promise.resolve({ carriers: [{ name: 'Delhivery', code: 'DELHIVERY' }] });
      }
      return Promise.resolve({ order: mockOrder });
    });
    (apiClient.put as jest.Mock).mockResolvedValue({ success: true });
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();
  });

  it('renders loading state initially', async () => {
    render(<AdminOrderDetailPage />);
    expect(apiClient.get).toHaveBeenCalledWith('/orders/order123');
    // Assuming loading skeleton has no text but we can wait for data to appear
    await waitFor(() => {
        expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });
  });

  it('renders order details correctly', async () => {
    render(<AdminOrderDetailPage />);
    
    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Test Product')).toBeInTheDocument();
      expect(screen.getByText('User Name')).toBeInTheDocument();
      expect(screen.getByText('₹270.00')).toBeInTheDocument();
    });
  });

  it('confirms via modal before updating status', async () => {
    render(<AdminOrderDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    // Selecting a status opens the confirmation modal — it must NOT fire the API yet.
    fireEvent.change(select, { target: { value: 'delivered' } });
    expect(apiClient.put).not.toHaveBeenCalled();

    // Confirm in the modal → the API fires with the chosen status.
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/orders/order123/status',
        expect.objectContaining({ status: 'delivered', reason: 'admin_update' })
      );
    });
  });

  /*
    "Shipped" is deliberately NOT a status-dialog action on this page any more.

    That dialog only ever collected a tracking number, and the server then put every
    outstanding unit in ONE parcel — right by accident on a multi-item order, and a
    silent over-ship the rest of the time. Choosing what is actually in the box belongs
    to the Parcels panel, so the dropdown routes there instead of flipping the order.
  */
  it('does not open the status dialog for "shipped" — parcels own that', async () => {
    render(<AdminOrderDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'shipped' } });

    // No tracking-number dialog, and above all no status write.
    expect(screen.queryByPlaceholderText(/123456789012/)).not.toBeInTheDocument();
    expect(apiClient.put).not.toHaveBeenCalled();
  });

  /*
    ── THE RECEIVING END OF THE ORDERS-LIST HAND-OFF ──────────────────────────────
    Picking "Shipped" on a multi-item order in /admin/orders navigates here with
    `?parcel=1` rather than shipping everything in one box. Landing the admin on the
    order page with nothing open would turn that into a dead end, so the param opens
    the create-parcel form — the same form this page's own dropdown opens.
  */
  describe('?parcel=1 hand-off from the orders list', () => {
    it('opens the create-parcel form and strips the param', async () => {
      (useSearchParams as jest.Mock).mockReturnValue(searchParams({ parcel: '1' }));
      render(<AdminOrderDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      });

      // Stripped so a reload — or a Back into this history entry — does not re-open it.
      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith(
          '/admin/orders/order123', { scroll: false });
      });
      // The hand-off must never write a status by itself; it only opens a form.
      expect(apiClient.put).not.toHaveBeenCalled();
    });

    it('does nothing without the param', async () => {
      render(<AdminOrderDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      });

      expect(mockRouter.replace).not.toHaveBeenCalled();
    });

    it('handles the param once, so a refetch cannot re-open the form', async () => {
      (useSearchParams as jest.Mock).mockReturnValue(searchParams({ parcel: '1' }));
      const { rerender } = render(<AdminOrderDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      });
      await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledTimes(1));

      /*
        The effect re-runs on every render, and the panel calls back into `fetchOrder`
        after each parcel is created. Without the one-shot latch, creating one parcel
        would immediately re-open the form for another.
      */
      rerender(<AdminOrderDetailPage />);
      await waitFor(() => {
        expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
      });
      expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    });
  });

  it('does not update status when the modal is cancelled', async () => {
    render(<AdminOrderDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/ORD-001/)).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'delivered' } });

    // Dismiss the modal via its Cancel button → no API call.
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(apiClient.put).not.toHaveBeenCalled();
  });
  
  it('handles fetch error', async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(new Error('Fetch failed'));
    render(<AdminOrderDetailPage />);
    
    await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith('Failed to load order details');
        expect(mockRouter.push).toHaveBeenCalledWith('/admin/orders');
    });
  });
});
