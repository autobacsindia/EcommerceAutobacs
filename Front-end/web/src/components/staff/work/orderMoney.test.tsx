import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkOrderPanel from './WorkOrderPanel';
import type { OrderMoney, WorkOrder } from './types';

const get = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: (...a: unknown[]) => get(...a), post: jest.fn() } }));
jest.mock('@/lib/http/tokenManager', () => ({ tokenManager: { ensureCsrfToken: jest.fn(), getHeaders: () => ({}) } }));

type Line = WorkOrder['lines'][number];
const line = (i: number, price: number, quantity: number): Line => ({
  itemId: `i${i}`, name: `Part ${i}`, variantLabel: null, quantity, price,
  stage: 'stock_check', stageLabel: 'Needs stock check', stock: 'pending', supplierName: '', paymentInitiatedAt: null,
  refundRequestedAt: null, accountsApprovedAt: null, unshipped: quantity, actions: [],
});

const order = (lines: Line[], money: OrderMoney | null): WorkOrder => ({
  id: 'o1', orderNumber: 'ORD1', createdAt: '2026-10-06T05:00:00Z', enteredAt: '2026-10-06T05:00:00Z',
  status: 'processing', paymentStatus: 'paid', totalAmount: money?.total ?? 0, source: 'sales', soldBy: 'GTM',
  customer: { name: 'Test Buyer', email: '', phone: '' }, city: '', summary: null, needs: [], inWorkflow: true, owesGoodie: false,
  shippingAddress: null, payment: null, lines, parcels: [], cancellations: [], history: [],
  canShip: false, canDispatchOwn: false, canContactCustomer: false, money,
});

const moneyFor = (lines: Line[], extra: Partial<OrderMoney> = {}): OrderMoney => {
  const priced = lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, price: l.price, listPrice: null, lineTotal: Math.round(l.price * 100) * l.quantity / 100 }));
  const itemsTotal = priced.reduce((s, l) => s + Math.round(l.lineTotal * 100), 0) / 100;
  return { lines: priced, itemsTotal, subtotal: itemsTotal, discount: 0, couponCode: '', shipping: 0, tax: 0, total: itemsTotal, gatewayOffer: null, ...extra };
};

const show = (o: WorkOrder) => {
  get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/staff/work/orders/') ? { success: true, order: o } : {}));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WorkOrderPanel orderId="o1" />
    </QueryClientProvider>,
  );
};

beforeEach(() => get.mockReset());

describe('item prices on the order (accounts)', () => {
  it('a 25-line bulk order: every line shows unit price × qty = line total, then the totals', async () => {
    const lines = Array.from({ length: 25 }, (_, i) => line(i + 1, 1250 + i * 100, (i % 3) + 1));
    const money = moneyFor(lines);
    show(order(lines, money));
    await screen.findByText('Part 1');
    const prices = screen.getAllByTestId('line-price');
    expect(prices).toHaveLength(25);
    expect(prices[0]).toHaveTextContent('₹1,250 × 1 = ₹1,250');
    expect(prices[24]).toHaveTextContent('₹3,650 × 1 = ₹3,650');
    const summary = screen.getByLabelText('Order amount');
    expect(within(summary).getByText('Items (25)')).toBeInTheDocument();
    expect(within(summary).getByText('Order total').nextSibling).toHaveTextContent(`₹${money.total!.toLocaleString('en-IN')}`);
    expect(screen.queryByText(/cannot be added up|add up to/)).not.toBeInTheDocument();
  });

  it('shows the discount with its coupon, the rep offer price, delivery and the GST inside', async () => {
    const lines = [line(1, 4500, 2), line(2, 1000, 1)];
    const money = moneyFor(lines, { discount: 500, couponCode: 'DIWALI', shipping: 150, tax: 1449.15, total: 9650 });
    money.lines[0].listPrice = 5000;
    show(order(lines, money));
    const [first] = await screen.findAllByTestId('line-price');
    expect(first).toHaveTextContent('₹5,000₹4,500 × 2 = ₹9,000');
    const summary = screen.getByLabelText('Order amount');
    expect(within(summary).getByText('Discount (DIWALI)').nextSibling).toHaveTextContent('−₹500');
    expect(within(summary).getByText('Delivery').nextSibling).toHaveTextContent('₹150');
    expect(within(summary).getByText('Order total').nextSibling).toHaveTextContent('₹9,650');
    expect(within(summary).getByText('Includes GST of ₹1,449.15')).toBeInTheDocument();
  });

  it('a legacy line with no saved price says so instead of a made-up number', async () => {
    const lines = [line(1, 5000, 1), line(2, 0, 2)];
    const money = moneyFor(lines, { itemsTotal: null, subtotal: 7000, total: 7000 });
    money.lines[1] = { ...money.lines[1], price: null, lineTotal: null };
    show(order(lines, money));
    await screen.findByText('Part 2');
    expect(screen.getAllByTestId('line-price')).toHaveLength(1);
    expect(screen.getByText('Price not saved')).toBeInTheDocument();
    expect(screen.getByText(/cannot be added up/)).toBeInTheDocument();
  });

  it('other teams (no money from the server) see no prices', async () => {
    show(order([line(1, 5000, 1)], null));
    await screen.findByText('Part 1');
    expect(screen.queryByTestId('line-price')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Order amount')).not.toBeInTheDocument();
  });
});
