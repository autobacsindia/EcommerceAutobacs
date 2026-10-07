import { getRefundBadge, type RefundBadgeOrder } from './refundBadge';

const item = { _id: 'i1', quantity: 1 };
const lineCancelled = (refundStatus: string, extra: Partial<RefundBadgeOrder> = {}): RefundBadgeOrder => ({
  status: 'cancelled',
  paymentStatus: 'paid',
  items: [item],
  cancellations: [{ lines: [{ itemId: 'i1', quantity: 1 }], refund: { status: refundStatus } }],
  ...extra,
});
const label = (o: RefundBadgeOrder) => getRefundBadge(o)?.label ?? null;

describe('orders list Refund badge — order cancelled item by item', () => {
  // The bug: this read "Refund due" after the item refund had completed.
  it('reads Refunded once every item refund completed', () => {
    expect(label(lineCancelled('completed'))).toBe('Refunded ✓');
  });

  it('reads Refund due while an item refund has not been sent', () => {
    expect(label(lineCancelled('pending'))).toBe('Refund due');
  });

  it('reads Refunding… while Razorpay settles', () => {
    expect(label(lineCancelled('processing'))).toBe('Refunding…');
  });

  it('reads Refund failed when an item refund failed', () => {
    expect(label(lineCancelled('failed'))).toBe('Refund failed');
  });

  it('a pending item outranks a completed one — money is still owed', () => {
    const o = lineCancelled('completed', {
      items: [item, { _id: 'i2', quantity: 1 }],
      cancellations: [
        { lines: [{ itemId: 'i1', quantity: 1 }], refund: { status: 'completed' } },
        { lines: [{ itemId: 'i2', quantity: 1 }], refund: { status: 'pending' } },
      ],
    });
    expect(label(o)).toBe('Refund due');
  });

  it('reads Refund due for items the old admin cancel left without a refund record', () => {
    const o = lineCancelled('completed', { items: [item, { _id: 'i2', quantity: 1 }] });
    expect(label(o)).toBe('Refund due');
  });

  it('shows nothing for an unpaid order (nothing was owed)', () => {
    expect(label(lineCancelled('not_applicable', { paymentStatus: 'pending' }))).toBeNull();
  });

  it('shows nothing on a live order whose cancelled item has no money attached', () => {
    expect(label(lineCancelled('not_applicable', { status: 'processing' }))).toBeNull();
  });
});

describe('orders list Refund badge — whole-order refund (unchanged)', () => {
  const whole = (extra: Partial<RefundBadgeOrder>): RefundBadgeOrder => ({ status: 'cancelled', paymentStatus: 'paid', ...extra });

  it('due when cancelled and paid with no refund yet', () => {
    expect(label(whole({}))).toBe('Refund due');
  });
  it('follows refundDetails', () => {
    expect(label(whole({ refundDetails: { status: 'processing' } }))).toBe('Refunding…');
    expect(label(whole({ refundDetails: { status: 'failed' } }))).toBe('Refund failed');
    expect(label(whole({ refundDetails: { status: 'completed' } }))).toBe('Refunded ✓');
  });
  it('refunded when the payment is marked refunded', () => {
    expect(label(whole({ paymentStatus: 'refunded' }))).toBe('Refunded ✓');
  });
  it('nothing for a delivered order', () => {
    expect(label({ status: 'delivered', paymentStatus: 'paid' })).toBeNull();
  });
});
