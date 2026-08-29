import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminReturnsPage from './page';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

jest.mock('@/lib/api');

// Generic lucide-react mock — every icon renders a stub span, so the test never
// needs updating when the page's icon set changes.
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_t, name) => () => <span data-testid={`icon-${String(name)}`} />,
}));

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

const listResponse = {
  requests: [
    {
      _id: 'ret000001',
      order: { _id: 'ord1', orderNumber: 'AB-1001' },
      user: { name: 'Asha Rao', email: 'asha@example.com' },
      type: 'return',
      status: 'pending',
      items: [{ product: { name: 'Wiper Blade', images: [] }, quantity: 2, reason: 'manufacturing_defect', unitPrice: 500 }],
      refund: { productValue: 1000 },
      timeline: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  pagination: { currentPage: 1, totalPages: 1 },
  count: 1,
};

describe('AdminReturnsPage (new flow)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith(API_ENDPOINTS.ADMIN_RETURNS)) return Promise.resolve(listResponse as never);
      return Promise.resolve({ request: { ...listResponse.requests[0], problemDescription: 'rattles' } } as never);
    });
  });

  it('renders the returns list with order number, customer and status', async () => {
    render(<AdminReturnsPage />);
    expect(await screen.findByText('#AB-1001')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    // 'PENDING' also appears as a filter <option>; assert the status badge exists too.
    expect(screen.getAllByText('PENDING').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('₹1,000.00')).toBeInTheDocument();
  });

  it('opens the detail modal and loads the request detail endpoint', async () => {
    render(<AdminReturnsPage />);
    await screen.findByText('#AB-1001');
    fireEvent.click(screen.getByTitle('View'));
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(API_ENDPOINTS.ADMIN_RETURN_DETAIL('ret000001')));
    expect(await screen.findByText('rattles')).toBeInTheDocument();
  });

  it('offers the offline escape hatch, and refuses to fire it without a note', async () => {
    render(<AdminReturnsPage />);
    await screen.findByText('#AB-1001');
    fireEvent.click(screen.getByTitle('View'));
    const button = await screen.findByRole('button', { name: /mark returned \(offline\)/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/what happened/i), { target: { value: 'Returned at the counter' } });
    expect(button).toBeEnabled();

    mockApi.patch.mockResolvedValue({} as never);
    fireEvent.click(button);
    await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith(
      API_ENDPOINTS.RETURN_OFFLINE_RECEIVED('ret000001'),
      { note: 'Returned at the counter' },
    ));
  });

  it('hides the offline action on a terminal return — it must not be reopened', async () => {
    const refunded = { ...listResponse.requests[0], status: 'refunded', problemDescription: 'rattles' };
    mockApi.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith(API_ENDPOINTS.ADMIN_RETURNS)) return Promise.resolve({ ...listResponse, requests: [refunded] } as never);
      return Promise.resolve({ request: refunded } as never);
    });

    render(<AdminReturnsPage />);
    await screen.findByText('#AB-1001');
    fireEvent.click(screen.getByTitle('View'));
    await screen.findByText('rattles');
    expect(screen.queryByRole('button', { name: /mark returned \(offline\)/i })).not.toBeInTheDocument();
  });

  it('does not read an offline return as missing its evidence', async () => {
    const offline = { ...listResponse.requests[0], origin: 'admin_offline', problemDescription: 'walk-in' };
    mockApi.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith(API_ENDPOINTS.ADMIN_RETURNS)) return Promise.resolve({ ...listResponse, requests: [offline] } as never);
      return Promise.resolve({ request: offline } as never);
    });

    render(<AdminReturnsPage />);
    await screen.findByText('#AB-1001');
    fireEvent.click(screen.getByTitle('View'));
    expect(await screen.findByText(/do not apply/i)).toBeInTheDocument();
    expect(screen.queryByText('No video')).not.toBeInTheDocument();
    expect(screen.queryByText('No proof')).not.toBeInTheDocument();
  });

  it('records an offline refund with its reference instead of calling the gateway', async () => {
    const ready = {
      ...listResponse.requests[0],
      status: 'received',
      inspection: { passed: true },
      problemDescription: 'rattles',
    };
    mockApi.get.mockImplementation((endpoint: string) => {
      if (endpoint.startsWith(API_ENDPOINTS.ADMIN_RETURNS)) return Promise.resolve({ ...listResponse, requests: [ready] } as never);
      if (endpoint === API_ENDPOINTS.RETURN_REFUND_PREVIEW('ret000001')) {
        return Promise.resolve({
          preview: {
            productValue: 1000, listValue: 1000, discountShare: 0, couponCode: null,
            orderTotal: 1500, alreadyRefunded: 0, maxRefundable: 1500, suggestedRestocking: 0,
            shippingDeductionDefault: 0, paidBy: null, fullRefundOnly: false, note: '',
          },
        } as never);
      }
      return Promise.resolve({ request: ready } as never);
    });

    render(<AdminReturnsPage />);
    await screen.findByText('#AB-1001');
    fireEvent.click(screen.getByTitle('View'));

    fireEvent.click(await screen.findByLabelText(/already paid offline/i));
    // The reference is the only evidence an offline payout happened — no reference, no button.
    const submit = screen.getByRole('button', { name: /record ₹1,000.00 refunded/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/UTR/i), { target: { value: 'RCPT-8821' } });
    mockApi.post.mockResolvedValue({} as never);
    fireEvent.click(submit);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
      API_ENDPOINTS.RETURN_REFUND('ret000001'),
      expect.objectContaining({ method: 'offline', offlineMethod: 'cash', reference: 'RCPT-8821' }),
    ));
  });

  it('opens the record-offline-return modal from the header', async () => {
    render(<AdminReturnsPage />);
    await screen.findByText('#AB-1001');
    fireEvent.click(screen.getByRole('button', { name: /record offline return/i }));
    expect(await screen.findByText(/Record an offline return/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Order number, customer name/i)).toBeInTheDocument();
  });

  describe('offline return — picking order lines', () => {
    // Two variants of ONE product plus a legacy WooCommerce line with no catalogue
    // product at all. Both shapes are live in prod and both break a product-id-keyed list.
    const orderDetail = {
      _id: 'ord1',
      orderNumber: 'AB-1001',
      status: 'delivered',
      paymentStatus: 'paid',
      totalAmount: 1600,
      createdAt: new Date().toISOString(),
      items: [
        { _id: 'line-a', product: { _id: 'prod-1', name: 'Mat (Black)', images: [] }, variantId: 'var-black', quantity: 1, price: 300, name: 'Mat', image: '' },
        { _id: 'line-b', product: { _id: 'prod-1', name: 'Mat (Beige)', images: [] }, variantId: 'var-beige', quantity: 2, price: 400, name: 'Mat', image: '' },
        { _id: 'line-woo', product: null, variantId: null, quantity: 1, price: 500, name: 'Legacy Woo item', image: '' },
      ],
    };

    const openPicker = async () => {
      mockApi.get.mockImplementation((endpoint: string) => {
        if (endpoint.startsWith(API_ENDPOINTS.ADMIN_RETURNS)) return Promise.resolve(listResponse as never);
        if (endpoint.startsWith(API_ENDPOINTS.ADMIN_ORDERS)) return Promise.resolve({ orders: [orderDetail] } as never);
        if (endpoint === API_ENDPOINTS.ORDER_DETAIL('ord1')) return Promise.resolve({ order: orderDetail } as never);
        return Promise.resolve({ request: listResponse.requests[0] } as never);
      });

      render(<AdminReturnsPage />);
      await screen.findByText('#AB-1001');
      fireEvent.click(screen.getByRole('button', { name: /record offline return/i }));
      fireEvent.change(await screen.findByPlaceholderText(/Order number, customer name/i), { target: { value: 'AB-1001' } });
      fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
      fireEvent.click(await screen.findByText(/₹1,600.00/));
      return screen.findByText('Mat (Beige)');
    };

    it('keeps two variants of one product independently selectable', async () => {
      await openPicker();
      const boxes = screen.getAllByRole('checkbox');
      // 3 line checkboxes + the 2 option checkboxes below the note.
      fireEvent.click(boxes[1]); // Mat (Beige)

      // Selecting the second variant must NOT tick the first — a product-id key did.
      expect(boxes[0]).not.toBeChecked();
      expect(boxes[1]).toBeChecked();
    });

    it('disables a legacy line with no catalogue product and says why', async () => {
      await openPicker();
      expect(screen.getByText(/no catalogue product/i)).toBeInTheDocument();
      expect(screen.getAllByRole('checkbox')[2]).toBeDisabled();
    });

    it('submits the order line id and variant, not just the product id', async () => {
      await openPicker();
      fireEvent.click(screen.getAllByRole('checkbox')[1]);
      fireEvent.change(screen.getByPlaceholderText(/e\.g\. Customer brought/i), { target: { value: 'Walk-in' } });

      mockApi.post.mockResolvedValue({ request: { _id: 'ret000002' } } as never);
      fireEvent.click(screen.getByRole('button', { name: /record return/i }));

      await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
        API_ENDPOINTS.RETURN_OFFLINE_CREATE,
        expect.objectContaining({
          orderId: 'ord1',
          items: [expect.objectContaining({ itemId: 'line-b', productId: 'prod-1', variantId: 'var-beige', quantity: 2 })],
        }),
      ));
    });
  });
});
