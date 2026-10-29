/**
 * "Edit order": only what the server offers is shown, a reason is required, and the
 * request carries what the screen showed (stages and parcel states) so the server can
 * refuse a correction against an order that moved meanwhile.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OrderCorrection from './OrderCorrection';
import type { WorkOrder } from './types';

const post = jest.fn();
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { post: (...a: unknown[]) => post(...a) } }));

const line = (itemId: string, name: string, stage: WorkOrder['lines'][number]['stage'], stageLabel: string) => ({
  itemId, name, variantLabel: null, quantity: 1, price: 1000, stage, stageLabel, stock: null, supplierName: '',
  paymentInitiatedAt: null, refundRequestedAt: null, accountsApprovedAt: null, unshipped: 1, actions: [],
});
const parcel = (id: string, sequence: number, status: 'shipped' | 'delivered', extra = {}) => ({
  id, sequence, status, courier: 'DTDC', trackingNumber: 'D1', shippedAt: '2026-08-10T06:30:00.000Z',
  deliveredAt: status === 'delivered' ? '2026-08-14T06:30:00.000Z' : null,
  items: [{ name: 'Mat', quantity: 1 }], photoUrl: null, canMarkDelivered: false, ...extra,
});

const order = (over: Partial<WorkOrder> = {}): WorkOrder => ({
  id: 'o1', orderNumber: 'ORD1', createdAt: '2026-07-01T05:00:00Z', enteredAt: '2026-07-01T05:00:00Z',
  status: 'shipped', paymentStatus: 'paid', totalAmount: 3000, source: 'website', soldBy: 'Website',
  customer: { name: 'Ravi', email: '', phone: '' }, city: 'Kochi', summary: '', needs: [], inWorkflow: true, owesGoodie: false,
  shippingAddress: null, payment: null,
  lines: [line('i1', 'Bull bar', 'with_supplier', 'Ordered From Supplier'), line('i2', 'Fog lamp', 'to_ship', 'In Stock'), line('i3', 'Mat', 'shipped', 'Dispatched')],
  parcels: [parcel('s1', 1, 'shipped')], cancellations: [], history: [], canShip: true, canDispatchOwn: false, canContactCustomer: false,
  corrections: { dispatch: ['i1', 'i2'], inTransit: ['s1'], delivered: [], parcels: ['s1'], back: ['i1', 'i2'] },
  ...over,
} as WorkOrder);

const renderIt = (o: WorkOrder, onDone = jest.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <OrderCorrection order={o} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
};
const openIt = () => fireEvent.click(screen.getByRole('button', { name: /Edit order/ }));
const why = (text = 'Sent via Google Chat') => fireEvent.change(screen.getByLabelText(/Why\?/), { target: { value: text } });
const save = () => screen.getByRole('button', { name: /Save correction/ });

beforeEach(() => post.mockReset());

it('is not offered when the server allows no correction', () => {
  renderIt(order({ corrections: null }));
  expect(screen.queryByRole('button', { name: /Edit order/ })).toBeNull();
});

it('offers only what the order allows', () => {
  renderIt(order());
  openIt();
  expect(screen.getByRole('radio', { name: /Mark as dispatched/ })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Mark as delivered/ })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Fix courier/ })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Move back to New Order/ })).toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: /back to Dispatched/ })).toBeNull(); // nothing delivered
});

it('dispatched: every item ticked, a reason required, and the screen\'s view sent along', async () => {
  const done = { success: true, order: order() };
  post.mockResolvedValue(done);
  const onDone = renderIt(order());
  openIt();
  fireEvent.click(screen.getByRole('radio', { name: /Mark as dispatched/ }));
  expect(screen.getByRole('checkbox', { name: /Bull bar/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Fog lamp/ })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: /Fog lamp/ }));
  fireEvent.change(screen.getByLabelText(/^Courier/), { target: { value: ' Delhivery ' } });
  fireEvent.change(screen.getByLabelText(/^Dispatch date/), { target: { value: '2026-08-01' } });
  expect(save()).toBeDisabled();
  why('abc');
  expect(save()).toBeDisabled(); // too short
  why();
  fireEvent.click(save());

  await waitFor(() => expect(onDone).toHaveBeenCalledWith(done));
  expect(post).toHaveBeenCalledWith('/staff/work/orders/o1/correct', {
    action: 'dispatched', reason: 'Sent via Google Chat', itemIds: ['i1'], shipmentIds: [],
    expectedStages: { i1: 'with_supplier', i2: 'to_ship', i3: 'shipped' }, expectedParcels: { s1: 'shipped' },
    courierName: 'Delhivery', trackingNumber: '', shippedOn: '2026-08-01',
  });
});

it('delivered: items and parcels on their way, with the delivery date', async () => {
  post.mockResolvedValue({ success: true, order: order() });
  renderIt(order());
  openIt();
  fireEvent.click(screen.getByRole('radio', { name: /Mark as delivered/ }));
  expect(screen.getByRole('checkbox', { name: /Parcel 1: Mat × 1 · DTDC D1/ })).toBeChecked();
  expect(screen.getByText(/return window counts from this date/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/^Delivery date/), { target: { value: '2026-08-20' } });
  why();
  fireEvent.click(save());
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1]).toMatchObject({ action: 'delivered', itemIds: ['i1', 'i2'], shipmentIds: ['s1'], deliveredOn: '2026-08-20' });
});

it('fixing a parcel starts from what it says now', async () => {
  post.mockResolvedValue({ success: true, order: order() });
  renderIt(order({ parcels: [parcel('s1', 1, 'delivered')], corrections: { dispatch: [], inTransit: [], delivered: ['s1'], parcels: ['s1'], back: [] } }));
  openIt();
  fireEvent.click(screen.getByRole('radio', { name: /Fix courier/ }));
  expect(screen.getByLabelText(/^Courier/)).toHaveValue('DTDC');
  expect(screen.getByLabelText(/^Tracking number/)).toHaveValue('D1');
  expect(screen.getByLabelText(/^Dispatch date/)).toHaveValue('2026-08-10');
  expect(screen.getByLabelText(/^Delivery date/)).toHaveValue('2026-08-14');
  fireEvent.change(screen.getByLabelText(/^Tracking number/), { target: { value: 'D2' } });
  why('Wrong AWB');
  fireEvent.click(save());
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][1]).toMatchObject({ action: 'parcel', shipmentIds: ['s1'], courierName: 'DTDC', trackingNumber: 'D2' });
});

it('going back starts with nothing ticked, so it is always a choice', () => {
  renderIt(order());
  openIt();
  fireEvent.click(screen.getByRole('radio', { name: /Move back to New Order/ }));
  expect(screen.getByRole('checkbox', { name: /Bull bar/ })).not.toBeChecked();
  why();
  expect(save()).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /Bull bar/ }));
  expect(save()).toBeEnabled();
});

it('asks about the free gift only when one is owed', () => {
  renderIt(order({ owesGoodie: true }));
  openIt();
  fireEvent.click(screen.getByRole('radio', { name: /Mark as dispatched/ }));
  expect(screen.getByRole('checkbox', { name: /free gift went in this parcel/ })).toBeChecked();
});

it('shows the server\'s refusal and keeps the form', async () => {
  post.mockRejectedValue(Object.assign(new Error('This order was changed by someone else just now. Refresh it and try again.'), { status: 409 }));
  const onDone = renderIt(order());
  openIt();
  fireEvent.click(screen.getByRole('radio', { name: /Mark as dispatched/ }));
  why();
  fireEvent.click(save());
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed by someone else|Could not save/);
  expect(onDone).not.toHaveBeenCalled();
  expect(screen.getByRole('form', { name: 'Edit order' })).toBeInTheDocument();
});
