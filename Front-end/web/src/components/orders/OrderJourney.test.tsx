/**
 * The order-journey tracker: the path a line is on, where it stands, who moved
 * it and when, steps it skipped, and the refund branch.
 */
import { render, screen, within } from '@testing-library/react';
import type { WorkOrder } from '@/components/staff/work/types';
import { buildJourney } from './journeySteps';
import OrderJourney from './OrderJourney';

type Line = WorkOrder['lines'][number];
type Hist = WorkOrder['history'][number];

const line = (over: Partial<Line> = {}): Line => ({
  itemId: 'i1', name: 'Coilover kit', variantLabel: null, quantity: 1, price: 1000,
  stage: 'stock_check', stageLabel: null, stock: 'pending', supplierName: '', paymentInitiatedAt: null,
  refundRequestedAt: null, accountsApprovedAt: null, unshipped: 1, actions: [], ...over,
});
const h = (code: string, at: string, by = 'Priya', itemId: string | null = 'i1', team = 'Procurement'): Hist =>
  ({ code, at, by, team, itemId, action: code, item: '', note: '' });
const ENTERED = h('entered', '2026-10-01T04:30:00Z', 'System', null, '');

const order = (lines: Line[], history: Hist[], over: Partial<WorkOrder> = {}): WorkOrder => ({
  id: 'o1', orderNumber: 'ORD-1', createdAt: '2026-10-01T04:00:00Z', enteredAt: '2026-10-01T04:30:00Z',
  status: 'processing', paymentStatus: 'paid', totalAmount: 5000, source: 'website', soldBy: 'Website',
  customer: { name: 'Asha', email: '', phone: '' }, city: 'Kochi', summary: null, needs: [],
  inWorkflow: true, owesGoodie: false, shippingAddress: null, payment: null, lines, parcels: [], cancellations: [],
  // The API sends history newest first.
  history: [...history].reverse(), canShip: false, canDispatchOwn: false, canContactCustomer: false, ...over,
});

const states = (o: WorkOrder, i = 0) => buildJourney(o)[i].steps.map((s) => `${s.label}:${s.state}`);

describe('buildJourney', () => {
  it('a just-paid order: Paid done, New Order now, the rest not yet', () => {
    expect(states(order([line()], [ENTERED]))).toEqual([
      'Paid:done', 'New Order:current', 'In Stock:upcoming', 'Payment Pending:upcoming',
      'Ordered From Supplier:upcoming', 'Dispatched:upcoming', 'Delivered:upcoming',
    ]);
  });

  it('pins who and when onto each step from the history', () => {
    const o = order([line({ stage: 'payment_pending', stock: 'in_stock' })], [
      ENTERED,
      h('stock_in_stock', '2026-10-01T06:00:00Z', 'Priya'),
      h('payment_pending', '2026-10-01T07:00:00Z', 'Ravi'),
    ]);
    const [j] = buildJourney(o);
    expect(j.steps.find((s) => s.key === 'to_ship')).toMatchObject({ state: 'done', by: 'Priya', at: '2026-10-01T06:00:00Z' });
    expect(j.steps.find((s) => s.key === 'payment_pending')).toMatchObject({ state: 'current', by: 'Ravi' });
    expect(j.branch).toBeNull();
  });

  it('a step the line went past with nothing recorded shows as skipped', () => {
    // Paid the supplier straight from New Order: never "In Stock".
    const o = order([line({ stage: 'with_supplier', stock: 'ordered' })], [ENTERED, h('stock_ordered', '2026-10-02T05:00:00Z')]);
    expect(states(o)).toEqual([
      'Paid:done', 'New Order:done', 'In Stock:skipped', 'Payment Pending:skipped',
      'Ordered From Supplier:current', 'Dispatched:upcoming', 'Delivered:upcoming',
    ]);
  });

  it('our own warehouse takes the short path, and a delivered line is all done', () => {
    const o = order([line({ stage: 'delivered', stock: 'own_stock' })], [
      ENTERED,
      h('stock_own_stock', '2026-10-01T06:00:00Z'),
      h('shipped_own', '2026-10-01T09:00:00Z', 'Priya', null),
      h('delivered', '2026-10-03T09:00:00Z', 'Omar', null, 'Operations'),
    ]);
    expect(states(o)).toEqual(['Paid:done', 'New Order:done', 'Our Warehouse:done', 'Dispatched:done', 'Delivered:done']);
    expect(buildJourney(o)[0].steps.at(-1)).toMatchObject({ by: 'Omar', team: 'Operations' });
  });

  it("a warehouse line's dispatch time is its own, not a supplier parcel's", () => {
    const o = order([line({ stage: 'shipped', stock: 'own_stock' }), line({ itemId: 'i2', stage: 'shipped', stock: 'ordered' })], [
      ENTERED,
      h('shipped_own', '2026-10-01T09:00:00Z', 'Priya', null),
      h('shipped', '2026-10-04T09:00:00Z', 'Ravi', null),
    ]);
    const [own, supplier] = buildJourney(o);
    expect(own.steps.find((s) => s.key === 'shipped')).toMatchObject({ at: '2026-10-01T09:00:00Z', by: 'Priya' });
    expect(supplier.steps.find((s) => s.key === 'shipped')).toMatchObject({ at: '2026-10-04T09:00:00Z', by: 'Ravi' });
  });

  it('out of stock goes down the refund branch, which shows where it stands', () => {
    const o = order([line({ stage: 'accounts_approval', stock: 'out_of_stock' })], [
      ENTERED,
      h('stock_out_of_stock', '2026-10-01T06:00:00Z'),
      h('refund_requested', '2026-10-01T08:00:00Z', 'Sam', 'i1', 'GTM'),
    ]);
    const [j] = buildJourney(o);
    expect(j.steps.map((s) => s.state)).toEqual(['done', 'done', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(j.branch!.map((s) => `${s.key}:${s.state}`)).toEqual([
      'customer_decision:done', 'accounts_approval:current', 'cancelled:upcoming',
    ]);
    expect(j.branch![1]).toMatchObject({ by: 'Sam', team: 'GTM' });
  });

  it('an admin cancellation that never went out of stock is just "Cancelled"', () => {
    const [j] = buildJourney(order([line({ stage: 'cancelled' })], [ENTERED]));
    expect(j.branch!.map((s) => `${s.key}:${s.state}`)).toEqual(['cancelled:done']);
  });

  it("one line's history never lands on another line", () => {
    const o = order(
      [line({ stage: 'to_ship', stock: 'in_stock' }), line({ itemId: 'i2', name: 'Lift kit', stage: 'stock_check' })],
      [ENTERED, h('stock_in_stock', '2026-10-01T06:00:00Z', 'Priya', 'i1')],
    );
    const [a, b] = buildJourney(o);
    expect(a.steps[2]).toMatchObject({ state: 'current', by: 'Priya' });
    expect(b.steps[1].state).toBe('current');
    expect(b.steps[2]).toMatchObject({ state: 'upcoming', by: null });
  });

  it('an unpaid order has no journey yet', () => {
    expect(buildJourney(order([line()], [], { inWorkflow: false }))).toEqual([]);
  });
});

describe('<OrderJourney>', () => {
  it('lays out every step with the current one marked, plus the key facts', () => {
    render(<OrderJourney order={order([line({ stage: 'to_ship', stock: 'in_stock' })], [ENTERED, h('stock_in_stock', '2026-10-01T06:00:00Z')])} />);
    const track = screen.getByRole('list', { name: 'Journey of Coilover kit' });
    expect(within(track).getAllByRole('listitem')).toHaveLength(7);
    expect(within(track).getByText('In Stock').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(track).getByText(/Priya/)).toBeInTheDocument();
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('₹5,000')).toBeInTheDocument();
  });

  it('names each product when there is more than one, and shows the refund branch', () => {
    render(<OrderJourney order={order(
      [line(), line({ itemId: 'i2', name: 'Lift kit', stage: 'customer_decision', stock: 'out_of_stock' })],
      [ENTERED, h('stock_out_of_stock', '2026-10-01T06:00:00Z', 'Priya', 'i2')],
    )} />);
    expect(screen.getByText('Coilover kit × 1')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Refund path of Lift kit' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Refund path of Coilover kit' })).toBeNull();
  });

  it('before payment it says so instead of drawing an empty track', () => {
    render(<OrderJourney order={order([line()], [], { inWorkflow: false, enteredAt: null })} />);
    expect(screen.getByText(/starts once the customer has paid/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows the soonest expected delivery of the parcels still on their way', () => {
    const parcel = (id: string, status: 'shipped' | 'delivered', date: string) => ({
      id, sequence: 1, status, courier: 'Delhivery', trackingNumber: 'T', shippedAt: null, deliveredAt: null,
      items: [], photoUrl: null, canMarkDelivered: false, eta: { date, setBy: 'Omar', setAt: null },
    });
    render(<OrderJourney order={order([line({ stage: 'shipped', stock: 'ordered' })], [ENTERED], {
      parcels: [parcel('p1', 'delivered', '2026-10-02'), parcel('p2', 'shipped', '2026-10-09'), parcel('p3', 'shipped', '2026-10-06')],
    })} />);
    const fact = screen.getByText('Expected delivery').parentElement!;
    expect(fact).toHaveTextContent("06/10/2026"); // p3, not the delivered p1 or the later p2
  });

  it('the team panel can hide the facts it already shows', () => {
    render(<OrderJourney order={order([line()], [ENTERED])} showFacts={false} />);
    expect(screen.queryByText('Sold by')).toBeNull();
  });
});
