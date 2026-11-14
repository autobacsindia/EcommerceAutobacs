import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkOrderPanel from './WorkOrderPanel';
import type { SaleHistory, WorkOrder } from './types';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));
jest.mock('@/lib/http/tokenManager', () => ({ tokenManager: { ensureCsrfToken: jest.fn(), getHeaders: () => ({}) } }));

const order = (saleHistory: SaleHistory | null | undefined): WorkOrder => ({
  id: 'o1', orderNumber: 'ORD1', createdAt: '2026-11-10T05:00:00Z', enteredAt: '2026-11-10T05:00:00Z',
  status: 'processing', paymentStatus: 'paid', totalAmount: 18000, source: 'sales', soldBy: 'Nevin',
  customer: { name: 'Test Buyer', email: '', phone: '' }, city: '', summary: null, needs: [], inWorkflow: true, owesGoodie: false,
  shippingAddress: null, payment: null, lines: [], parcels: [], cancellations: [], history: [],
  canShip: false, canDispatchOwn: false, canContactCustomer: false, money: null, saleHistory,
});

const HISTORY: SaleHistory = {
  startedAs: 'Website order',
  changes: [
    {
      at: '2026-11-14T10:12:00Z', by: 'Arjun', from: null, to: 'Sam', note: 'Customer confirmed on WhatsApp',
      proofRequired: true, files: [{ id: 'f1', name: 'chat.png', contentType: 'image/png', bytes: 40 }],
    },
    { at: '2026-11-14T11:00:00Z', by: 'Old admin', from: 'Sam', to: 'Nevin', note: '', proofRequired: false, files: [] },
  ],
};

const show = (impl: () => Promise<unknown>) => {
  get.mockImplementation((url: string) => (url.startsWith('/staff/work/orders/') ? impl() : Promise.resolve({})));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WorkOrderPanel orderId="o1" />
    </QueryClientProvider>,
  );
};

describe('Sale history on the order panel (accounts)', () => {
  beforeEach(() => get.mockReset());

  it('shows how the order started, then each change with who, when, note and proof — read-only', async () => {
    show(() => Promise.resolve({ success: true, order: order(HISTORY) }));
    const box = await screen.findByRole('region', { name: 'Sale history' });
    expect(within(box).getByText('Website order')).toBeInTheDocument();

    const [first, second] = within(box).getAllByTestId('sale-change');
    expect(first).toHaveTextContent('Website → Sam');
    expect(first).toHaveTextContent('changed by Arjun');
    expect(first).toHaveTextContent('14 Nov 2026, 3:42 pm IST');
    expect(first).toHaveTextContent('Customer confirmed on WhatsApp');
    expect(within(first).getByRole('link', { name: /chat\.png/ })).toHaveAttribute('href', '/api/v1/staff/attribution/orders/o1/proof/f1');

    expect(second).toHaveTextContent('Sam → Nevin');
    expect(second).toHaveTextContent('Made before proof was required');
    expect(within(second).queryByRole('link')).toBeNull();

    // Nothing to change it with.
    expect(within(box).queryByRole('combobox')).toBeNull();
    expect(within(box).queryByRole('button')).toBeNull();
  });

  it.each([['null', null], ['missing (older server)', undefined], ['no changes', { startedAs: 'Website order', changes: [] }]])(
    'shows nothing extra when the history is %s',
    async (_, saleHistory) => {
      show(() => Promise.resolve({ success: true, order: order(saleHistory as SaleHistory | null | undefined) }));
      expect(await screen.findByText('ORD1')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Sale history' })).toBeNull();
    },
  );

  it('when the order cannot load, shows the error and no history', async () => {
    show(() => Promise.reject(new Error('Network down')));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sale history' })).toBeNull();
  });
});
