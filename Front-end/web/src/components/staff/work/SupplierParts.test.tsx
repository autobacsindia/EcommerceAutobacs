import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SupplierParts, { paymentsByPart, SupplierChanges } from './SupplierParts';
import type { SupplierPart, WorkOrder } from './types';
import type { OrderPayment } from '@/components/payments/api';

const post = jest.fn();
const patch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) },
}));
// The payment form and detail have their own tests; here only that they open with the right part.
jest.mock('@/components/payments/PaymentRequestForm', () => ({
  __esModule: true,
  default: ({ supplier }: { supplier: { partId?: string; lines: { name: string }[] } }) => (
    <div data-testid="pay-form">pay {supplier.partId} for {supplier.lines[0].name}</div>
  ),
}));
jest.mock('@/components/payments/PaymentRequestDetail', () => ({ __esModule: true, default: () => null }));

const part = (over: Partial<SupplierPart>): SupplierPart => ({
  id: 'p1', what: '', supplierName: 'G S Enterprises', status: 'active', state: 'to_order', paymentRef: '', orderedAt: null,
  createdAt: null, createdByName: '', replacedAt: null, replacedByName: '', replacedWith: null, replaces: null, reasonCode: '', reason: '',
  ...over,
});
const pr = (over: Partial<OrderPayment>): OrderPayment => ({
  id: 'r1', number: 'PR-0088', status: 'paid', statusLabel: 'Paid', amount: 2065, itemIds: ['i1'], itemNames: ['Jerry Can 20L'],
  payee: 'G S Enterprises', paidAt: null, createdAt: '2026-11-18T05:00:00Z', kind: 'supplier', ...over,
} as OrderPayment);

type Line = WorkOrder['lines'][number];
const baseLine: Line = {
  itemId: 'i1', name: 'Jerry Can 20L', variantLabel: 'jerry can with locking mount', quantity: 1, price: 4500,
  stage: 'with_supplier', stageLabel: 'Ordered From Supplier', stock: 'ordered', supplierName: 'G S Enterprises', paymentInitiatedAt: null,
  refundRequestedAt: null, accountsApprovedAt: null, unshipped: 1, actions: ['supplier_parts'],
  split: false, supplierParts: [part({ id: 'main', state: 'ordered' })], partsWaiting: '',
};
const order = { id: 'o1', orderNumber: 'ORD1', source: 'website', soldBy: 'Website', customer: { name: 'Ravi' } } as unknown as WorkOrder;

const renderParts = (line: Line, requests: OrderPayment[] = [], onDone = jest.fn()) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SupplierParts order={order} line={line} requests={requests} onDone={onDone} />
  </QueryClientProvider>,
);

beforeEach(() => { post.mockReset(); patch.mockReset(); jest.spyOn(window, 'confirm').mockReturnValue(true); });

describe('SupplierParts — an item never split', () => {
  it('shows nothing to people who cannot change suppliers (accounts read-only)', () => {
    const { container } = renderParts({ ...baseLine, actions: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('change supplier needs a new supplier and a reason; a paid PR is explained, then sent to the server', async () => {
    const onDone = jest.fn();
    post.mockResolvedValue({ success: true, order: {} });
    renderParts(baseLine, [pr({})], onDone);
    fireEvent.click(screen.getByRole('button', { name: /Change supplier/ }));
    expect(screen.getByText(/PR-0088 is paid — it stays paid/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Change supplier' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New supplier'), { target: { value: 'Trek N Trade' } });
    expect(submit).toBeDisabled(); // no reason yet
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'other' } });
    expect(submit).toBeDisabled(); // "Other" needs words
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'supplier_refunded' } });
    fireEvent.change(screen.getByLabelText(/Details/), { target: { value: 'out of stock' } });
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/parts/main/change',
      { supplierName: 'Trek N Trade', reasonCode: 'supplier_refunded', reasonNote: 'out of stock' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('an approved, unpaid PR blocks the change and says what accounts must do', () => {
    renderParts({ ...baseLine, stage: 'payment_pending', supplierParts: [part({ id: 'main', state: 'payment_pending', paymentRef: 'PR-0090' })] },
      [pr({ id: 'r2', number: 'PR-0090', status: 'approved', statusLabel: 'Approved' })]);
    fireEvent.click(screen.getByRole('button', { name: /Change supplier/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('PR-0090 is already approved by accounts and not paid. Ask accounts to put it on hold and decline it first.');
    fireEvent.change(screen.getByLabelText('New supplier'), { target: { value: 'Trek N Trade' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'late' } });
    expect(screen.getByRole('button', { name: 'Change supplier' })).toBeDisabled();
  });

  it('the server\'s refusal is shown, not swallowed', async () => {
    post.mockRejectedValue({ rawData: { message: 'Someone else just updated this item. Refresh and try again.' } });
    renderParts(baseLine);
    fireEvent.click(screen.getByRole('button', { name: /Split across suppliers/ }));
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'Mount Co' } });
    fireEvent.change(screen.getByLabelText(/What is bought/), { target: { value: 'Locking mount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add part' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/parts', { supplierName: 'Mount Co', what: 'Locking mount' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Refresh and try again/);
  });
});

describe('SupplierParts — split across suppliers', () => {
  const split: Line = {
    ...baseLine, split: true, stage: 'payment_pending', stageLabel: 'Payment Pending (1 of 2 parts ordered)',
    partsWaiting: 'Locking mount from Mount Co (PR-0091 not paid yet)',
    supplierParts: [
      part({ id: 'old', what: 'Jerry can', status: 'replaced', state: 'replaced', replacedWith: 'can', replacedByName: 'Aromal S', replacedAt: '2026-11-19T06:00:00Z', reason: 'Supplier refunded — out of stock' }),
      part({ id: 'can', what: 'Jerry can', supplierName: 'Trek N Trade', state: 'ordered', replaces: 'old' }),
      part({ id: 'mount', what: 'Locking mount', supplierName: 'Mount Co', state: 'payment_pending', paymentRef: 'PR-0091' }),
      part({ id: 'extra', what: 'Spare key', supplierName: 'Key Co', state: 'to_order' }),
    ],
  };
  const requests = [
    pr({ id: 'r88', number: 'PR-0088' }), // raised before the split: the first part
    pr({ id: 'r90', number: 'PR-0090', partId: 'can', payee: 'Trek N Trade' }),
    pr({ id: 'r91', number: 'PR-0091', partId: 'mount', payee: 'Mount Co', status: 'submitted', statusLabel: 'Waiting for approval' }),
  ];

  it('lists each active part with its own status and payment; the old supplier in the history with its PR', () => {
    renderParts(split, requests);
    const list = screen.getAllByRole('listitem');
    expect(list[0]).toHaveTextContent('Part 1Jerry canfrom Trek N TradeOrdered From Supplier');
    expect(within(list[0]).getByRole('button', { name: 'PR-0090' })).toBeInTheDocument();
    expect(list[1]).toHaveTextContent('Locking mountfrom Mount CoPayment Pending');
    expect(within(list[1]).getByRole('button', { name: 'PR-0091' })).toBeInTheDocument();
    const history = screen.getByLabelText('Supplier changes');
    expect(history).toHaveTextContent('G S Enterprises');
    expect(history).toHaveTextContent('Trek N Trade');
    expect(history).toHaveTextContent('Changed by Aromal S on 19 Nov 2026 · Supplier refunded — out of stock');
    expect(within(history).getByRole('button', { name: 'PR-0088' })).toBeInTheDocument();
  });

  it('a part to order offers its own payment, for that part only; a never-paid extra part can be removed', async () => {
    post.mockResolvedValue({ success: true, order: {} });
    renderParts(split, requests);
    expect(screen.queryByRole('button', { name: /Request payment to Mount Co/ })).toBeNull(); // already waiting
    expect(screen.queryByRole('button', { name: 'Remove part 1' })).toBeNull(); // has a payment
    fireEvent.click(screen.getByRole('button', { name: 'Remove part 3' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/parts/extra/remove', {}));
    fireEvent.click(screen.getByRole('button', { name: 'Request payment to Key Co' }));
    expect(screen.getByTestId('pay-form')).toHaveTextContent('pay extra for Jerry Can 20L — jerry can with locking mount · part: Spare key');
  });

  it('edit cannot switch the supplier of a part that has a payment', async () => {
    patch.mockResolvedValue({ success: true, order: {} });
    renderParts(split, requests);
    fireEvent.click(screen.getByRole('button', { name: 'Edit part 1' }));
    expect(screen.getByLabelText('Supplier')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('What is bought'), { target: { value: 'Jerry can 20L' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff/work/orders/o1/lines/i1/parts/can', { what: 'Jerry can 20L' }));
  });

  it('read-only viewers see the parts and history but no buttons', () => {
    renderParts({ ...split, actions: [] }, requests);
    expect(screen.getByText('Suppliers for this item')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change supplier|Add another|Request payment|Edit part/ })).toBeNull();
  });
});

describe('paymentsByPart / SupplierChanges', () => {
  it('a PR with no part belongs to the first part; an unknown part id also falls back to it', () => {
    const parts = [part({ id: 'a' }), part({ id: 'b' })];
    const m = paymentsByPart(parts, [pr({ id: 'x' }), pr({ id: 'y', partId: 'b' }), pr({ id: 'z', partId: 'gone' }), pr({ id: 'e', kind: 'expense' })], 'i1');
    expect(m.get('a')!.map((r) => r.id)).toEqual(['x', 'z']);
    expect(m.get('b')!.map((r) => r.id)).toEqual(['y']);
  });

  it('nothing to show when no supplier was ever changed', () => {
    const { container } = render(<SupplierChanges parts={[part({})]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
