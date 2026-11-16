/**
 * The free-delivery seal's server check fails CLOSED: only an explicit
 * `deliveryFees.offer.live === true` from the server shows the seal.
 */
import { getFreeDeliveryOfferLive } from './freeDelivery';

const mockFetch = jest.fn();
jest.mock('@/lib/server-api', () => ({ serverFetch: (...a: unknown[]) => mockFetch(...a) }));

beforeEach(() => mockFetch.mockReset());

describe('getFreeDeliveryOfferLive', () => {
  it('true only when the server says the offer is live', async () => {
    mockFetch.mockResolvedValue({ deliveryFees: { offer: { live: true } } });
    await expect(getFreeDeliveryOfferLive()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('/delivery-fees/public', {
      next: { tags: ['promo:festival-offer'], revalidate: 60 },
    });
  });
  it.each([
    ['offer off', { deliveryFees: { offer: { live: false } } }],
    ['no offer', { deliveryFees: { offer: null } }],
    ['older backend shape', { success: true }],
    ['truthy but not true', { deliveryFees: { offer: { live: 'yes' } } }],
  ])('false when %s', async (_n, body) => {
    mockFetch.mockResolvedValue(body);
    await expect(getFreeDeliveryOfferLive()).resolves.toBe(false);
  });
  it('false when the endpoint errors or does not exist (404)', async () => {
    mockFetch.mockRejectedValue(new Error('[serverFetch] 404 Not Found'));
    await expect(getFreeDeliveryOfferLive()).resolves.toBe(false);
  });
});
