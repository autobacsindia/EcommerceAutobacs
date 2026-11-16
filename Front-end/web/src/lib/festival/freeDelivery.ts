import { serverFetch } from '@/lib/server-api';

/** Shape of GET /delivery-fees/public, as far as the storefront needs it. */
interface DeliveryFeesPublic {
  deliveryFees?: { offer?: { live?: boolean } | null } | null;
}

const REVALIDATE_SECONDS = 60;

/**
 * Is the Black Friday "no shipping, packing or delivery charges" offer really
 * running at checkout right now? Server-decided (fees on + waiver on + offer
 * window + Black Friday live); the storefront only uses the answer to decide
 * whether the free-delivery seal may be shown.
 *
 * The seal is a promise about money, so this fails CLOSED: any error, an older
 * backend without the endpoint, or a missing field all answer false. Cached for
 * a minute under the festival-offer tag, which the offer's admin save purges.
 */
export async function getFreeDeliveryOfferLive(): Promise<boolean> {
  try {
    const res = await serverFetch<DeliveryFeesPublic>('/delivery-fees/public', {
      next: { tags: ['promo:festival-offer'], revalidate: REVALIDATE_SECONDS },
    });
    return res?.deliveryFees?.offer?.live === true;
  } catch {
    return false;
  }
}
