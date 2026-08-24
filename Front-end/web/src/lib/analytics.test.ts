/**
 * Promotional attribution on the analytics events.
 *
 * These properties exist to answer one question honestly: did the campaign CAUSE the
 * sale? Without them a scan-to-purchase funnel counts every purchase by anyone who ever
 * landed on the offer page, which flatters the campaign instead of measuring it. The
 * cases below are the ones where that distinction silently collapses — a missing key, a
 * dropped `undefined`, an unapplied coupon reported as an attributed sale.
 */

import posthog from 'posthog-js';
import { trackPurchase, trackCampaignOfferViewed } from './analytics';

jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { capture: jest.fn(), __loaded: true },
}));

const captured = () => (posthog.capture as jest.Mock).mock.calls;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
  (posthog as unknown as { __loaded: boolean }).__loaded = true;
});

describe('purchase attribution', () => {
  it('carries the coupon, campaign and discount actually applied', () => {
    trackPurchase({
      orderId: 'o1', value: 10000, itemCount: 2,
      couponCode: 'FESTIVE2026', campaignSlug: 'festive-2026', discount: 800,
    });
    expect(captured()[0][0]).toBe('purchase');
    expect(captured()[0][1]).toMatchObject({
      order_id: 'o1', coupon_code: 'FESTIVE2026', campaign_slug: 'festive-2026', discount: 800,
    });
  });

  /*
    The shape has to be STABLE. A property that is present on some purchases and absent
    on others cannot be filtered on reliably, and a saved funnel would quietly stop
    matching the day an organic sale came through.
  */
  it('emits the attribution keys on an organic purchase too, as explicit nulls', () => {
    trackPurchase({ orderId: 'o2', value: 5000 });
    const props = captured()[0][1] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['coupon_code', 'campaign_slug', 'discount']),
    );
    expect(props.coupon_code).toBeNull();
    expect(props.campaign_slug).toBeNull();
    // Zero, not null — this one is summed in charts, and null would poison the average.
    expect(props.discount).toBe(0);
  });

  it('defaults the currency so revenue charts do not split by an absent field', () => {
    trackPurchase({ orderId: 'o3', value: 100 });
    expect((captured()[0][1] as Record<string, unknown>).currency).toBe('INR');
  });
});

describe('campaign offer viewed', () => {
  it('reports a live offer with the visitor\'s eligibility', () => {
    trackCampaignOfferViewed({ slug: 'festive-2026', offerLive: true, eligible: true });
    expect(captured()[0][0]).toBe('campaign_offer_viewed');
    expect(captured()[0][1]).toEqual({
      campaign_slug: 'festive-2026', offer_live: true, eligible: true,
    });
  });

  it('distinguishes "offer is over" from "visitor cannot use it"', () => {
    trackCampaignOfferViewed({ slug: 'festive-2026', offerLive: false, eligible: null });
    expect(captured()[0][1]).toEqual({
      campaign_slug: 'festive-2026', offer_live: false, eligible: null,
    });
  });
});

describe('when PostHog is not configured', () => {
  it('no-ops rather than throwing, so a missing key cannot break checkout', () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    expect(() => trackPurchase({ orderId: 'o4', value: 1 })).not.toThrow();
    expect(() => trackCampaignOfferViewed({ slug: 's', offerLive: true })).not.toThrow();
    expect(captured()).toHaveLength(0);
  });
});
