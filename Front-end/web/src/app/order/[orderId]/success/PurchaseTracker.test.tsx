import React from 'react';
import { act, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import PurchaseTracker, { type PurchasePayload } from './PurchaseTracker';

jest.mock('@/lib/metaPixel', () => ({
  trackPurchase: jest.fn(),
}));

import { trackPurchase } from '@/lib/metaPixel';

const ORDER_ID = 'order_123';

const purchase: PurchasePayload = {
  send_to: 'AW-123/LABEL',
  transaction_id: ORDER_ID,
  value: 4999,
  currency: 'INR',
  items: [{ item_id: 'p1', item_name: 'Roof rack', price: 4999, quantity: 1 }],
};

/** Renders the tracker for a genuinely-paid order unless overridden. */
function renderTracker(props: Partial<React.ComponentProps<typeof PurchaseTracker>> = {}) {
  return render(
    <PurchaseTracker
      orderId={ORDER_ID}
      purchase={purchase}
      paymentStatus="paid"
      orderStatus="processing"
      {...props}
    />
  );
}

function installGtag(): jest.Mock {
  const gtag = jest.fn();
  (window as unknown as { gtag?: unknown }).gtag = gtag;
  return gtag;
}

describe('PurchaseTracker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
    delete (window as unknown as { gtag?: unknown }).gtag;
    delete (window as unknown as { fbq?: unknown }).fbq;
    (trackPurchase as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('fires the purchase conversion when gtag is already loaded', () => {
    const gtag = installGtag();
    renderTracker();

    expect(gtag).toHaveBeenCalledWith('event', 'purchase', purchase);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`gtag_fired_${ORDER_ID}`)).toBe('1');
  });

  it('waits for a late-loading gtag instead of giving up on the first check', () => {
    // gtag.js is injected by next/script `afterInteractive`, so it can appear
    // AFTER this component's effect has already run.
    renderTracker();
    expect(sessionStorage.getItem(`gtag_fired_${ORDER_ID}`)).toBeNull();

    act(() => { jest.advanceTimersByTime(1000); });

    const gtag = installGtag();
    act(() => { jest.advanceTimersByTime(200); });

    expect(gtag).toHaveBeenCalledWith('event', 'purchase', purchase);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`gtag_fired_${ORDER_ID}`)).toBe('1');
  });

  it('stops polling and leaves the flag unset when the tag never loads', () => {
    renderTracker();

    act(() => { jest.advanceTimersByTime(60_000); });

    // Unset flag = a later visit can still convert (both platforms de-dup).
    expect(sessionStorage.getItem(`gtag_fired_${ORDER_ID}`)).toBeNull();

    const gtag = installGtag();
    act(() => { jest.advanceTimersByTime(5_000); });
    expect(gtag).not.toHaveBeenCalled();
  });

  it('does not fire twice for the same order within the session', () => {
    sessionStorage.setItem(`gtag_fired_${ORDER_ID}`, '1');
    const gtag = installGtag();

    renderTracker();

    expect(gtag).not.toHaveBeenCalled();
  });

  it('never fires for a non-captured order', () => {
    const gtag = installGtag();
    renderTracker({ paymentStatus: 'failed', orderStatus: 'cancelled' });

    act(() => { jest.advanceTimersByTime(20_000); });

    expect(gtag).not.toHaveBeenCalled();
    expect(trackPurchase).not.toHaveBeenCalled();
  });

  it('waits for a late-loading Meta Pixel too', () => {
    installGtag();
    const metaItems = [{ id: 'sku1', quantity: 1, item_price: 4999 }];
    renderTracker({ metaItems, metaValue: 4999 });

    expect(trackPurchase).not.toHaveBeenCalled();

    (window as unknown as { fbq?: unknown }).fbq = jest.fn();
    act(() => { jest.advanceTimersByTime(200); });

    expect(trackPurchase).toHaveBeenCalledWith(ORDER_ID, metaItems, 4999);
    expect(sessionStorage.getItem(`metapixel_fired_${ORDER_ID}`)).toBe('1');
  });

  it('stops polling when the user navigates away', () => {
    const { unmount } = renderTracker();
    unmount();

    const gtag = installGtag();
    act(() => { jest.advanceTimersByTime(5_000); });

    expect(gtag).not.toHaveBeenCalled();
  });
});
