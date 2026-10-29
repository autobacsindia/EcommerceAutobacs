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
    stage: 'stock_check', stageLabel: 'Needs stock check', stock: 'pending', supplierName: '', paymentInitiatedAt: null,
    refundRequestedAt: null, accountsApprovedAt: null, unshipped: 1, actions: ['in_stock', 'ordered', 'out_of_stock'],
  }],
  parcels: [], cancellations: [], history: [], canShip: false, canDispatchOwn: false, canContactCustomer: true,
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

  it('no separate "Ordered from supplier" button: the product offers "Request supplier payment" instead', async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/payment-requests/order/')
      ? { requests: [] }
      : { success: true, order: { ...base, canShip: true } }));
    renderPanel();
    expect(await screen.findByRole('button', { name: /Request supplier payment/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ordered from supplier' })).not.toBeInTheDocument();
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

  it('shows why a refund failed and lets accounts retry it', async () => {
    const failed = {
      id: 'c1', items: [{ name: 'Snorkel', quantity: 1 }], reason: 'out_of_stock', cancelledAt: '2026-10-07T05:00:00Z',
      refundStatus: 'failed', refundAmount: 6000, refundFailure: 'Gateway timeout', canSendRefund: true,
    };
    get.mockResolvedValue({ success: true, order: { ...base, cancellations: [failed] } });
    post.mockResolvedValue({ success: true, order: { ...base, cancellations: [{ ...failed, refundStatus: 'processing', refundFailure: '', canSendRefund: false }] } });
    renderPanel();

    expect(await screen.findByText('Gateway timeout')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refund' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/refunds/c1/send', {}));
    expect(await screen.findByText(/Refund sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry refund' })).not.toBeInTheDocument();
  });

  it('offers no refund button when the server does not allow it', async () => {
    get.mockResolvedValue({ success: true, order: { ...base, cancellations: [{
      id: 'c1', items: [{ name: 'Snorkel', quantity: 1 }], reason: 'out_of_stock', cancelledAt: null,
      refundStatus: 'failed', refundAmount: 6000, refundFailure: 'Gateway timeout', canSendRefund: false,
    }] } });
    renderPanel();
    await screen.findByText('Gateway timeout');
    expect(screen.queryByRole('button', { name: /retry refund|send refund/i })).not.toBeInTheDocument();
  });

  it('uploads the supplier proof as multipart with the CSRF header', async () => {
    const shippable = { ...base, canShip: true, lines: [{ ...base.lines[0], stage: 'with_supplier' as const, actions: ['ship' as const] }] };
    get.mockResolvedValue({ success: true, order: shippable });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, order: base }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPanel();

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'proof.jpg', { type: 'image/jpeg' });
    fireEvent.change(await screen.findByLabelText('Dispatch photo'), { target: { files: [file] } });
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

  it('takes a pasted screenshot as the dispatch photo, exactly like a chosen one', async () => {
    const shippable = { ...base, canShip: true, lines: [{ ...base.lines[0], stage: 'with_supplier' as const, actions: ['ship' as const] }] };
    get.mockResolvedValue({ success: true, order: shippable });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, order: base }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPanel();

    const courier = await screen.findByPlaceholderText('e.g. Delhivery');
    expect(screen.getByText(/or paste a screenshot/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload proof/i })).toBeDisabled();
    const shot = new File([new Uint8Array([0x89, 0x50])], 'image.png', { type: 'image/png' });
    fireEvent.paste(courier, { clipboardData: { files: [shot], items: [], types: ['Files'] } });
    expect(await screen.findByText(/^screenshot-.*\.png$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /upload proof/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/staff/work/orders/o1/ship');
    expect((fetchMock.mock.calls[0][1].body as FormData).get('photo')).toBeInstanceOf(Blob);
  });

  it('starts with every item ticked ("ship all"), including unchecked ones, and can send part', async () => {
    const two = {
      ...base, canShip: true, lines: [
        { ...base.lines[0], stage: 'with_supplier' as const, actions: ['ship' as const] },
        { ...base.lines[0], itemId: 'i2', name: 'Floor mat', stage: 'stock_check' as const, actions: ['in_stock' as const, 'ship' as const] },
      ],
    };
    get.mockResolvedValue({ success: true, order: two });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, order: base }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    renderPanel();

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'proof.jpg', { type: 'image/jpeg' });
    fireEvent.change(await screen.findByLabelText('Dispatch photo'), { target: { files: [file] } });
    expect(screen.getByText(/not stock-checked — will be marked in stock/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload proof & ship all items' })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'All items' }));
    expect(screen.getByRole('button', { name: /ship 0 of 2/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Floor mat/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload proof & ship 1 of 2 items' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0][1].body as FormData).get('itemIds') as string)).toEqual(['i2']);
  });

  it('records "Our warehouse" on an item', async () => {
    get.mockResolvedValue({ success: true, order: { ...base, lines: [{ ...base.lines[0], actions: ['in_stock', 'own_stock', 'ordered', 'out_of_stock'] }] } });
    post.mockResolvedValue({ success: true, order: base });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Our warehouse/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/stock', { stock: 'own_stock' }));
  });

  describe('dispatch from our warehouse', () => {
    const ours = (over: Partial<WorkOrder> = {}): WorkOrder => ({
      ...base, canDispatchOwn: true, lines: [
        { ...base.lines[0], stage: 'own_stock', stageLabel: 'Our Warehouse', stock: 'own_stock', actions: ['dispatch_own', 'out_of_stock', 'stock_undo'] },
        { ...base.lines[0], itemId: 'i2', name: 'Floor mat', stage: 'own_stock', stageLabel: 'Our Warehouse', stock: 'own_stock', actions: ['dispatch_own', 'out_of_stock', 'stock_undo'] },
      ],
      ...over,
    });

    it('needs courier and tracking — no photo — and posts only those to dispatch-own', async () => {
      get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/payment-requests/order/') ? { requests: [] } : { success: true, order: ours() }));
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, order: base }) });
      global.fetch = fetchMock as unknown as typeof fetch;
      renderPanel();

      expect(await screen.findByRole('form', { name: 'Dispatch from our warehouse' })).toBeInTheDocument();
      // No supplier route on these items: no supplier parcel form, no supplier payment button.
      expect(screen.queryByLabelText('Dispatch photo')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Request supplier payment/ })).not.toBeInTheDocument();

      const send = screen.getByRole('button', { name: 'Dispatch all items' });
      expect(send).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Courier'), { target: { value: 'Delhivery' } });
      expect(send).toBeDisabled(); // tracking still missing
      fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'DL555' } });
      expect(send).toBeEnabled();
      fireEvent.click(screen.getByRole('checkbox', { name: /Floor mat/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Dispatch 1 of 2 items' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/v1/staff/work/orders/o1/dispatch-own');
      expect(init.headers['X-XSRF-TOKEN']).toBe('t');
      const body = init.body as FormData;
      expect(body.get('courierName')).toBe('Delhivery');
      expect(body.get('trackingNumber')).toBe('DL555');
      expect(JSON.parse(body.get('itemIds') as string)).toEqual(['i1']);
      expect(body.get('photo')).toBeNull();
    });

    it('sends the photo when one is added, and says to pack the free gift', async () => {
      get.mockResolvedValue({ success: true, order: ours({ owesGoodie: true }) });
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, order: base }) });
      global.fetch = fetchMock as unknown as typeof fetch;
      renderPanel();

      expect(await screen.findByText(/Put the free gift in this box/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Courier'), { target: { value: 'Delhivery' } });
      fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'DL555' } });
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'parcel.jpg', { type: 'image/jpeg' });
      fireEvent.change(screen.getByLabelText('Parcel photo (optional)'), { target: { files: [file] } });
      fireEvent.click(screen.getByRole('button', { name: 'Dispatch all items' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect((fetchMock.mock.calls[0][1].body as FormData).get('photo')).toBeInstanceOf(Blob);
    });

    it('shows the server\'s refusal', async () => {
      get.mockResolvedValue({ success: true, order: ours() });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Only items marked "Our Warehouse" can go in this parcel. Refresh and choose again.' }) }) as unknown as typeof fetch;
      renderPanel();

      fireEvent.change(await screen.findByLabelText('Courier'), { target: { value: 'Delhivery' } });
      fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: 'DL555' } });
      fireEvent.click(screen.getByRole('button', { name: 'Dispatch all items' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/Only items marked "Our Warehouse"/);
    });

    it('the WhatsApp message promises a photo only when the parcel has one', async () => {
      get.mockResolvedValue({
        success: true,
        order: {
          ...base,
          parcels: [{ id: 's1', sequence: 1, status: 'shipped', courier: 'Delhivery', trackingNumber: 'DL555', shippedAt: null, deliveredAt: null, items: [{ name: 'Snorkel', quantity: 1 }], photoUrl: null, canMarkDelivered: false }],
        },
      });
      renderPanel();
      const href = decodeURIComponent((await screen.findByRole('link', { name: /send to customer/i })).getAttribute('href') || '');
      expect(href).toMatch(/Tracking number: DL555/);
      expect(href).not.toMatch(/photo/);
    });
  });

  describe('operations: courier progress on a parcel in transit', () => {
    const parcel = {
      id: 's1', sequence: 1, status: 'shipped', courier: 'Delhivery', trackingNumber: 'DL1', shippedAt: null, deliveredAt: null,
      items: [{ name: 'Snorkel', quantity: 1 }], photoUrl: null, canMarkDelivered: true, canAddStep: true, stepCount: 2,
      steps: [
        { status: 'in_transit' as const, label: 'In transit', note: 'Reached Kochi', at: '2026-10-27T05:00:00Z', by: 'Omar' },
        { status: 'picked_up' as const, label: 'Picked up', note: '', at: '2026-10-26T05:00:00Z', by: 'Omar' },
      ],
    };

    it('lists the updates, newest first, and posts a new one with the count it saw', async () => {
      get.mockResolvedValue({ success: true, order: { ...base, parcels: [parcel] } });
      post.mockResolvedValue({ success: true, order: base });
      renderPanel();

      const list = await screen.findByRole('list', { name: 'Updates for parcel 1' });
      expect(list).toHaveTextContent(/In transit · Reached Kochi/);
      expect(list).toHaveTextContent(/Omar/);

      expect(screen.queryByRole('button', { name: 'Save update' })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Parcel 1 status'), { target: { value: 'delivery_failed' } });
      fireEvent.change(screen.getByLabelText('Parcel 1 note'), { target: { value: ' Customer not at home ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save update' }));

      await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/parcels/s1/steps',
        { status: 'delivery_failed', note: 'Customer not at home', expectedSteps: 2 }));
    });

    it('no update form without the permission, or once delivered', async () => {
      get.mockResolvedValue({ success: true, order: { ...base, parcels: [{ ...parcel, canAddStep: false }] } });
      renderPanel();
      await screen.findByRole('list', { name: 'Updates for parcel 1' });
      expect(screen.queryByLabelText('Parcel 1 status')).not.toBeInTheDocument();
    });
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
    expect(screen.getByRole('img', { name: /dispatch photo/i })).toHaveAttribute('src', '/api/v1/staff/work/orders/o1/parcels/s1/photo');
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

  describe('undo and dispatch corrections', () => {
    it('shows Undo when the server allows it, and asks before undoing the stock decision', async () => {
      get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/payment-requests/order/')
        ? { requests: [] }
        : { success: true, order: { ...base, lines: [{ ...base.lines[0], stage: 'to_ship', stageLabel: 'In Stock', stock: 'in_stock', actions: ['out_of_stock', 'ship', 'stock_undo'] }] } }));
      post.mockResolvedValue({ success: true, order: base });
      window.confirm = jest.fn(() => true);
      renderPanel();
      fireEvent.click(await screen.findByRole('button', { name: /^Undo$/ }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/undo-stock', {}));
      expect(screen.queryByRole('button', { name: /Payment initiated/ })).not.toBeInTheDocument();
    });

    it('a stage shows its own colour: Payment Pending is red', async () => {
      get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/payment-requests/order/')
        ? { requests: [] }
        : { success: true, order: { ...base, lines: [{ ...base.lines[0], stage: 'payment_pending', stageLabel: 'Payment Pending', actions: [] }] } }));
      renderPanel();
      expect((await screen.findByText('Payment Pending')).className).toMatch(/bg-red-100/);
    });
  });

  it('operations can put a parcel marked delivered by mistake back in transit, after confirming', async () => {
    const delivered = { ...base, parcels: [{ id: 's1', sequence: 1, status: 'delivered' as const, courier: '', trackingNumber: '', shippedAt: null, deliveredAt: null, items: [], photoUrl: '/p', canMarkDelivered: false, canUndoDelivered: true }] };
    get.mockResolvedValue({ success: true, order: delivered });
    post.mockResolvedValue({ success: true, order: base });
    renderPanel();
    (window.confirm as jest.Mock).mockReturnValueOnce(false);
    fireEvent.click(await screen.findByRole('button', { name: /Undo delivered/ }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Undo delivered/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/undo-delivered', { shipmentId: 's1' }));
  });

  it('no Undo delivered button without the permission', async () => {
    get.mockResolvedValue({ success: true, order: { ...base, parcels: [{ id: 's1', sequence: 1, status: 'delivered' as const, courier: '', trackingNumber: '', shippedAt: null, deliveredAt: null, items: [], photoUrl: '/p', canMarkDelivered: false }] } });
    renderPanel();
    await screen.findByText(/Parcel 1/);
    expect(screen.queryByRole('button', { name: /Undo delivered/ })).toBeNull();
  });
});
