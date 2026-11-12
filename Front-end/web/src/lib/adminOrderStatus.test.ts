import { getAdminNextStatuses } from './adminOrderStatus';

/*
  The admin status menu used to offer every status from every status, so a cancelled
  order could be "moved back" to Processing — which the server then recorded as PAID.
  The server now refuses that; the menu must not offer it either.
*/
describe('getAdminNextStatuses', () => {
  it.each(['cancelled', 'returned'])('offers nothing for a closed order (%s)', (status) => {
    expect(getAdminNextStatuses(status)).toEqual([]);
  });

  it('offers nothing for an unpaid order — its payment moves it', () => {
    expect(getAdminNextStatuses('awaiting_payment')).toEqual([]);
  });

  it('never offers a move backwards from delivered', () => {
    expect(getAdminNextStatuses('delivered')).toEqual(['returned']);
  });

  it('a paid order can ship, be handed over in store, or be cancelled', () => {
    expect(getAdminNextStatuses('processing')).toEqual(['shipped', 'delivered', 'cancelled']);
  });

  it('a shipped order can only be delivered', () => {
    expect(getAdminNextStatuses('shipped')).toEqual(['delivered']);
  });

  it('an unknown status offers nothing', () => {
    expect(getAdminNextStatuses('weird')).toEqual([]);
  });
});
