import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkOrderPanel from './WorkOrderPanel';
import type { WorkOrder } from './types';

const get = jest.fn();
const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
jest.mock('@/lib/http/tokenManager', () => ({
  tokenManager: { ensureCsrfToken: jest.fn().mockResolvedValue(undefined), getHeaders: () => ({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 't' }) },
}));
jest.mock('./types', () => ({ ...jest.requireActual('./types'), shrinkPhoto: async (f: File) => f }));

const base: WorkOrder = {
  id: 'o1', orderNumber: 'ORD1', createdAt: '2026-10-06T05:00:00Z', enteredAt: '2026-10-06T05:00:00Z',
  status: 'processing', paymentStatus: 'paid', totalAmount: 6000, source: 'website', soldBy: 'Website',
  customer: { name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9876543210' }, city: 'Kochi, Kerala',
  summary: 'Needs stock check', needs: ['procurement'], inWorkflow: true, owesGoodie: false,
  shippingAddress: { addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
  payment: { razorpayPaymentId: 'pay_1', method: 'upi' },
  lines: [{
    itemId: 'i1', name: 'Snorkel', variantLabel: null, quantity: 1, price: 6000,
    stage: 'stock_check', stageLabel: 'Needs stock check', stock: 'pending', supplierName: '',
    refundRequestedAt: null, accountsApprovedAt: null, unshipped: 1, actions: ['in_stock', 'ordered', 'out_of_stock'],
  }],
  parcels: [], cancellations: [], history: [], canShip: false, canContactCustomer: true,
};

const renderPanel = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <WorkOrderPanel orderId="o1" />
  </QueryClientProvider>,
);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('WorkOrderPanel', () => {
  it('shows procurement its stock buttons and records "in stock"', async () => {
    get.mockResolvedValue({ success: true, order: base });
    post.mockResolvedValue({ success: true, order: { ...base, lines: [{ ...base.lines[0], stage: 'to_ship', stageLabel: 'In stock — to ship', actions: ['ordered', 'out_of_stock', 'ship'] }] } });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'In stock' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/stock', { stock: 'in_stock' }));
    expect(await screen.findByText('In stock — to ship')).toBeInTheDocument();
  });

  it('asks for the supplier name before marking "ordered"', async () => {
    get.mockResolvedValue({ success: true, order: base });
    post.mockResolvedValue({ success: true, order: base });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Ordered from supplier' }));
    fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Ram Traders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/stock', { stock: 'ordered', supplierName: 'Ram Traders' }));
  });

  it('shows nothing to press when the server grants no actions', async () => {
    get.mockResolvedValue({ success: true, order: { ...base, lines: [{ ...base.lines[0], actions: [] }] } });
    renderPanel();
    await screen.findByText('Snorkel');
    expect(screen.queryByRole('button', { name: /stock|supplier|refund/i })).not.toBeInTheDocument();
  });

  it('requires a note to send a refund back', async () => {
    get.mockResolvedValue({ success: true, order: { ...base, lines: [{ ...base.lines[0], stage: 'accounts_approval', stageLabel: 'Refund — waiting for accounts', actions: ['approve', 'reject'] }] } });
    post.mockResolvedValue({ success: true, order: base });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Send back' }));
    const send = screen.getByRole('button', { name: 'Send back to sales' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer will wait' } });
    fireEvent.click(send);

    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/refund', { approve: false, note: 'Customer will wait' }));
  });

  it('uploads the supplier proof as multipart with the CSRF header', async () => {
    const shippable = { ...base, canShip: true, lines: [{ ...base.lines[0], stage: 'with_supplier' as const, actions: ['ship' as const] }] };
    get.mockResolvedValue({ success: true, order: shippable });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, order: base }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPanel();

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'proof.jpg', { type: 'image/jpeg' });
    fireEvent.change(await screen.findByLabelText('Supplier photo'), { target: { files: [file] } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Delhivery'), { target: { value: 'Delhivery' } });
    fireEvent.click(screen.getByRole('button', { name: /upload proof/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/staff/work/orders/o1/ship');
    expect(init.headers['X-XSRF-TOKEN']).toBe('t');
    expect(init.headers['Content-Type']).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get('courierName')).toBe('Delhivery');
    expect(JSON.parse(form.get('itemIds') as string)).toEqual(['i1']);
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });

  it('gives the sales person a WhatsApp message with the tracking number', async () => {
    get.mockResolvedValue({
      success: true,
      order: {
        ...base,
        parcels: [{ id: 's1', sequence: 1, status: 'shipped', courier: 'Delhivery', trackingNumber: 'DL123', shippedAt: null, deliveredAt: null, items: [{ name: 'Snorkel', quantity: 1 }], photoUrl: '/api/v1/staff/work/orders/o1/parcels/s1/photo', canMarkDelivered: false }],
      },
    });
    renderPanel();

    const link = await screen.findByRole('link', { name: /send to customer/i });
    const href = decodeURIComponent(link.getAttribute('href') || '');
    expect(href).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(href).toMatch(/Tracking number: DL123/);
    expect(screen.getByRole('img', { name: /supplier photo/i })).toHaveAttribute('src', '/api/v1/staff/work/orders/o1/parcels/s1/photo');
  });

  it('hides "Send to customer" from teams that do not contact customers', async () => {
    get.mockResolvedValue({
      success: true,
      order: {
        ...base,
        canContactCustomer: false,
        parcels: [{ id: 's1', sequence: 1, status: 'shipped', courier: '', trackingNumber: '', shippedAt: null, deliveredAt: null, items: [], photoUrl: '/p', canMarkDelivered: true }],
      },
    });
    renderPanel();
    expect(await screen.findByRole('button', { name: /mark delivered/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /send to customer/i })).not.toBeInTheDocument();
  });

  it('shows the server\'s message when an action is refused', async () => {
    get.mockResolvedValue({ success: true, order: base });
    post.mockRejectedValue({ rawData: { message: 'Someone else just updated this item. Refresh and try again.' } });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'In stock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Someone else just updated/);
  });
});
