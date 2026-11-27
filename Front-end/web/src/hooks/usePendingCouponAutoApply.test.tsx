import { renderHook, waitFor } from '@testing-library/react';
import { toast } from 'react-hot-toast';
import { usePendingCouponAutoApply } from './usePendingCouponAutoApply';
import { savePendingCoupon, readPendingCoupon } from '@/lib/pendingCoupon';

jest.mock('react-hot-toast', () => ({ toast: { success: jest.fn() } }));

const cart = (items: { id: string; q?: number }[], couponCode: string | null = null) => ({
  couponCode,
  items: items.map(({ id, q = 1 }) => ({ product: { _id: id }, variantId: null, quantity: q })),
});

describe('usePendingCouponAutoApply', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
  });

  it('applies the pending code once and clears it when money came off', async () => {
    savePendingCoupon('HILUX5000');
    const apply = jest.fn().mockResolvedValue({ discountApplied: true });
    const { rerender } = renderHook(({ c }) => usePendingCouponAutoApply(c, true, apply), {
      initialProps: { c: cart([{ id: 'roll' }]) },
    });
    await waitFor(() => expect(apply).toHaveBeenCalledWith('HILUX5000'));
    await waitFor(() => expect(readPendingCoupon()).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('HILUX5000 applied');
    rerender({ c: cart([{ id: 'roll' }]) });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a guest or an empty cart', () => {
    savePendingCoupon('HILUX5000');
    const apply = jest.fn();
    renderHook(() => usePendingCouponAutoApply(cart([{ id: 'roll' }]), false, apply));
    renderHook(() => usePendingCouponAutoApply(cart([]), true, apply));
    expect(apply).not.toHaveBeenCalled();
  });

  it('never replaces a coupon the shopper chose', () => {
    savePendingCoupon('HILUX5000');
    const apply = jest.fn();
    renderHook(() => usePendingCouponAutoApply(cart([{ id: 'roll' }], 'OTHER10'), true, apply));
    expect(apply).not.toHaveBeenCalled();
    expect(readPendingCoupon()).toBe('HILUX5000');
  });

  it('a refusal stays pending, is not retried for the same cart, and is retried when the cart changes', async () => {
    savePendingCoupon('HILUX5000');
    const apply = jest.fn().mockRejectedValue(new Error('Coupon does not apply to items in your cart'));
    const { rerender } = renderHook(({ c }) => usePendingCouponAutoApply(c, true, apply), {
      initialProps: { c: cart([{ id: 'mat' }]) },
    });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    rerender({ c: cart([{ id: 'mat' }]) });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(readPendingCoupon()).toBe('HILUX5000');
    rerender({ c: cart([{ id: 'mat' }, { id: 'roll' }]) });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps the code when the server saved it without a discount', async () => {
    savePendingCoupon('HILUX5000');
    const apply = jest.fn().mockResolvedValue({ discountApplied: false });
    renderHook(() => usePendingCouponAutoApply(cart([{ id: 'roll' }]), true, apply));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(readPendingCoupon()).toBe('HILUX5000');
  });

  it('clears the pending code once it already sits on the cart', () => {
    savePendingCoupon('HILUX5000');
    const apply = jest.fn();
    renderHook(() => usePendingCouponAutoApply(cart([{ id: 'roll' }], 'HILUX5000'), true, apply));
    expect(apply).not.toHaveBeenCalled();
    expect(readPendingCoupon()).toBeNull();
  });
});
