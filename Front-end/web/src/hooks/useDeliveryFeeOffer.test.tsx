/**
 * Black Friday auto-apply (owner-approved, Nov 2026): a customer once missed the
 * "Apply" tap and abandoned an order with ₹8,367 of delivery fees. While the offer is
 * live and a PIN is known, the quote now asks for the waiver by itself. The flag is
 * intent only — the server still decides and prices everything.
 */
import { act, renderHook } from '@testing-library/react';
import {
  resetDeliveryFeeOfferIntent, shouldRequestOffer, useDeliveryFeeOffer,
} from './useDeliveryFeeOffer';

let offerLive = true;
jest.mock('@/hooks/queries/useDeliveryFeesPublic', () => ({
  useDeliveryFeesPublic: () => ({ chargeAtCheckout: true, offerLive, isLoading: false }),
}));

beforeEach(() => {
  offerLive = true;
  resetDeliveryFeeOfferIntent();
});

describe('useDeliveryFeeOffer auto-apply', () => {
  it('offer live + valid PIN → requested without any tap', () => {
    const { result } = renderHook(() => useDeliveryFeeOffer('500001'));
    expect(result.current[0]).toBe(true);
  });

  it('offer live but no / partial / invalid PIN → not requested yet', () => {
    expect(renderHook(() => useDeliveryFeeOffer('')).result.current[0]).toBe(false);
    expect(renderHook(() => useDeliveryFeeOffer('50000')).result.current[0]).toBe(false);
    expect(renderHook(() => useDeliveryFeeOffer('012345')).result.current[0]).toBe(false);
    expect(renderHook(() => useDeliveryFeeOffer(undefined)).result.current[0]).toBe(false);
  });

  it('offer not live (ended, or fees switched off) → not requested', () => {
    offerLive = false;
    const { result } = renderHook(() => useDeliveryFeeOffer('500001'));
    expect(result.current[0]).toBe(false);
  });

  it('"Remove" keeps it removed — across PIN changes and into checkout (another mount)', () => {
    const { result, rerender } = renderHook(({ pin }) => useDeliveryFeeOffer(pin), { initialProps: { pin: '500001' } });
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    rerender({ pin: '110001' });
    expect(result.current[0]).toBe(false);
    expect(window.sessionStorage.getItem('ab:deliveryFeeOffer')).toBe('0');
    // The checkout's summary mounts its own copy with the address PIN.
    expect(renderHook(() => useDeliveryFeeOffer('400001')).result.current[0]).toBe(false);
  });

  it('tapping "Apply" after a remove turns it back on', () => {
    const { result } = renderHook(() => useDeliveryFeeOffer('500001'));
    act(() => result.current[1](false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it('an explicit tap with no PIN is still sent (server answers "PIN first")', () => {
    const { result } = renderHook(() => useDeliveryFeeOffer(''));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});

describe('shouldRequestOffer', () => {
  it.each([
    ['auto', true, '560001', true],
    ['auto', true, '', false],
    ['auto', false, '560001', false],
    ['on', false, '', true],
    ['off', true, '560001', false],
  ] as const)('%s / live=%s / pin=%p → %s', (choice, live, pin, expected) => {
    expect(shouldRequestOffer(choice, live, pin)).toBe(expected);
  });
});
