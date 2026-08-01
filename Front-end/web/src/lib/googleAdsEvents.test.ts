/**
 * The failures these tests exist to catch are all SILENT — Google accepts a
 * malformed remarketing event, returns nothing, and simply never builds the
 * audience. Nothing shows up in a console or a dashboard until someone asks
 * months later why dynamic remarketing has no reach.
 */

const ADS_ID = 'AW-11434499615';
const CONTENT_ID = '11466';

/**
 * The module reads NEXT_PUBLIC_GOOGLE_ADS_ID at import time (Next inlines it at
 * build), so each test imports it fresh with the env it needs.
 */
async function loadModule(adsId: string | undefined) {
  jest.resetModules();
  if (adsId === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  else process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = adsId;
  return import('./googleAdsEvents');
}

function installGtag(): jest.Mock {
  const gtag = jest.fn();
  (window as unknown as { gtag?: unknown }).gtag = gtag;
  return gtag;
}

const originalEnv = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

describe('googleAdsEvents', () => {
  afterEach(() => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
    else process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = originalEnv;
  });

  it('sends view_item with the catalogue id in BOTH id spellings', async () => {
    const gtag = installGtag();
    const { trackGoogleViewItem } = await loadModule(ADS_ID);

    trackGoogleViewItem(CONTENT_ID, 849);

    expect(gtag).toHaveBeenCalledWith('event', 'view_item', {
      send_to: ADS_ID,
      currency: 'INR',
      value: 849,
      items: [
        {
          id: CONTENT_ID,
          item_id: CONTENT_ID,
          google_business_vertical: 'retail',
          price: 849,
        },
      ],
    });
  });

  it('marks every item as retail — without it Google silently ignores the event', async () => {
    const gtag = installGtag();
    const { trackGoogleViewItem, trackGoogleAddToCart } = await loadModule(ADS_ID);

    trackGoogleViewItem(CONTENT_ID, 100);
    trackGoogleAddToCart(CONTENT_ID, 200, 2);

    for (const call of gtag.mock.calls) {
      const items = (call[2] as { items?: Array<{ google_business_vertical: string }> }).items ?? [];
      for (const item of items) expect(item.google_business_vertical).toBe('retail');
    }
  });

  it('add_to_cart reports total value but UNIT price on the item', async () => {
    const gtag = installGtag();
    const { trackGoogleAddToCart } = await loadModule(ADS_ID);

    // 3 × ₹500
    trackGoogleAddToCart(CONTENT_ID, 1500, 3);

    const params = gtag.mock.calls[0][2] as {
      value: number;
      items: Array<{ price: number; quantity: number }>;
    };
    expect(params.value).toBe(1500);
    expect(params.items[0]).toMatchObject({ price: 500, quantity: 3 });
  });

  it('routes remarketing events to the account, never to a conversion label', async () => {
    const gtag = installGtag();
    const { trackGoogleViewItem } = await loadModule(ADS_ID);

    trackGoogleViewItem(CONTENT_ID);

    const params = gtag.mock.calls[0][2] as { send_to: string };
    expect(params.send_to).toBe(ADS_ID);
    expect(params.send_to).not.toContain('/');
  });

  it('sends begin_checkout with value only when no catalogue ids are available', async () => {
    const gtag = installGtag();
    const { trackGoogleBeginCheckout } = await loadModule(ADS_ID);

    trackGoogleBeginCheckout(4999);

    expect(gtag).toHaveBeenCalledWith('event', 'begin_checkout', {
      send_to: ADS_ID,
      currency: 'INR',
      value: 4999,
    });
  });

  it('is a no-op when gtag has not loaded (ad blocker, slow tag)', async () => {
    const { trackGoogleViewItem } = await loadModule(ADS_ID);
    expect(() => trackGoogleViewItem(CONTENT_ID, 100)).not.toThrow();
  });

  it('is a no-op when no Ads id is configured (preview/local builds)', async () => {
    const gtag = installGtag();
    const { trackGoogleViewItem } = await loadModule(undefined);

    trackGoogleViewItem(CONTENT_ID, 100);

    expect(gtag).not.toHaveBeenCalled();
  });

  it('never sends an event with an empty catalogue id', async () => {
    const gtag = installGtag();
    const { trackGoogleViewItem, trackGoogleAddToCart } = await loadModule(ADS_ID);

    trackGoogleViewItem('');
    trackGoogleAddToCart('', 100);

    expect(gtag).not.toHaveBeenCalled();
  });
});
