import { savePendingCoupon, readPendingCoupon, clearPendingCoupon, PENDING_COUPON_TTL_MS } from './pendingCoupon';

describe('pendingCoupon', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves upper-cased and reads back', () => {
    savePendingCoupon(' hilux5000 ');
    expect(readPendingCoupon()).toBe('HILUX5000');
  });

  it('ignores junk codes', () => {
    savePendingCoupon('<script>');
    expect(readPendingCoupon()).toBeNull();
    window.localStorage.setItem('roavion:pendingCoupon', '{not json');
    expect(readPendingCoupon()).toBeNull();
  });

  it('expires after the TTL', () => {
    savePendingCoupon('HILUX5000', 1000);
    expect(readPendingCoupon(1000 + PENDING_COUPON_TTL_MS - 1)).toBe('HILUX5000');
    expect(readPendingCoupon(1000 + PENDING_COUPON_TTL_MS + 1)).toBeNull();
    expect(window.localStorage.getItem('roavion:pendingCoupon')).toBeNull();
  });

  it('clears', () => {
    savePendingCoupon('HILUX5000');
    clearPendingCoupon();
    expect(readPendingCoupon()).toBeNull();
  });

  it('survives blocked storage', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => savePendingCoupon('HILUX5000')).not.toThrow();
    expect(readPendingCoupon()).toBeNull();
    spy.mockRestore(); set.mockRestore();
  });
});
