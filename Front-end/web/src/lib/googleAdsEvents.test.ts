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
async function loadModule(
  adsId: string | undefined,
  labels: Partial<Record<'view_item' | 'add_to_cart' | 'begin_checkout', string>> = {}
) {
  jest.resetModules();
  if (adsId === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  else process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = adsId;
  // Labels are read as literal process.env.* expressions in lib/googleAds.ts
  // (required for Next's build-time inlining), so set them the same way.
  if (labels.view_item) process.env.NEXT_PUBLIC_GOOGLE_ADS_VIEW_ITEM_LABEL = labels.view_item;
  else delete process.env.NEXT_PUBLIC_GOOGLE_ADS_VIEW_ITEM_LABEL;
  if (labels.add_to_cart) process.env.NEXT_PUBLIC_GOOGLE_ADS_ADD_TO_CART_LABEL = labels.add_to_cart;
  else delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ADD_TO_CART_LABEL;
  if (labels.begin_checkout)
    process.env.NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_LABEL = labels.begin_checkout;
  else delete process.env.NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_LABEL;
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
    delete process.env.NEXT_PUBLIC_GOOGLE_ADS_VIEW_ITEM_LABEL;
    delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ADD_TO_CART_LABEL;
    delete process.env.NEXT_PUBLIC_GOOGLE_ADS_BEGIN_CHECKOUT_LABEL;
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

  it('routes remarketing events to the account when no label is configured', async () => {
    const gtag = installGtag();
    const { trackGoogleViewItem } = await loadModule(ADS_ID);

    trackGoogleViewItem(CONTENT_ID);

    expect(gtag).toHaveBeenCalledTimes(1);
    const params = gtag.mock.calls[0][2] as { send_to: string };
    expect(params.send_to).toBe(ADS_ID);
    expect(params.send_to).not.toContain('/');
  });

  // Sending only the account-level event is the failure that made Google Ads
  // report "no entries yet" while the dataLayer looked perfectly healthy.
  it('ALSO sends a labelled conversion when the event has a conversion action', async () => {
    const gtag = installGtag();
    const { trackGoogleAddToCart } = await loadModule(ADS_ID, { add_to_cart: 'AbCdEfGh' });

    trackGoogleAddToCart(CONTENT_ID, 200, 2);

    expect(gtag).toHaveBeenCalledTimes(2);
    const targets = gtag.mock.calls.map((call) => (call[2] as { send_to: string }).send_to);
    expect(targets).toEqual([ADS_ID, `${ADS_ID}/AbCdEfGh`]);
    // Both carry the identical payload — only the destination differs.
    expect({ ...(gtag.mock.calls[0][2] as object), send_to: undefined }).toEqual({
      ...(gtag.mock.calls[1][2] as object),
      send_to: undefined,
    });
  });

  it('labels each funnel event independently', async () => {
    const gtag = installGtag();
    const { trackGoogleViewItem, trackGoogleBeginCheckout } = await loadModule(ADS_ID, {
      begin_checkout: 'ChKoUt99',
    });

    trackGoogleViewItem(CONTENT_ID, 100); // no label → account only
    trackGoogleBeginCheckout(500, [{ contentId: CONTENT_ID, price: 500, quantity: 1 }]);

    const byEvent = gtag.mock.calls.map((call) => [call[1], (call[2] as { send_to: string }).send_to]);
    expect(byEvent).toEqual([
      ['view_item', ADS_ID],
      ['begin_checkout', ADS_ID],
      ['begin_checkout', `${ADS_ID}/ChKoUt99`],
    ]);
  });

  it('sends no conversion when the label is set but the Ads id is not', async () => {
    const gtag = installGtag();
    const { trackGoogleAddToCart } = await loadModule(undefined, { add_to_cart: 'AbCdEfGh' });

    trackGoogleAddToCart(CONTENT_ID, 200, 2);

    expect(gtag).not.toHaveBeenCalled();
  });

  it('sends begin_checkout with the cart catalogue ids', async () => {
    const gtag = installGtag();
    const { trackGoogleBeginCheckout } = await loadModule(ADS_ID);

    trackGoogleBeginCheckout(6499, [
      { contentId: '11466', price: 4999, quantity: 1 },
      { contentId: '11475', price: 750, quantity: 2 },
    ]);

    expect(gtag).toHaveBeenCalledWith('event', 'begin_checkout', {
      send_to: ADS_ID,
      currency: 'INR',
      value: 6499,
      items: [
        { id: '11466', item_id: '11466', google_business_vertical: 'retail', price: 4999, quantity: 1 },
        { id: '11475', item_id: '11475', google_business_vertical: 'retail', price: 750, quantity: 2 },
      ],
    });
  });

  it('drops checkout lines with no catalogue id rather than sending an internal id', async () => {
    const gtag = installGtag();
    const { trackGoogleBeginCheckout } = await loadModule(ADS_ID);

    trackGoogleBeginCheckout(4999, [
      { contentId: null, price: 999, quantity: 1 },
      { contentId: '11466', price: 4000, quantity: 1 },
    ]);

    const params = gtag.mock.calls[0][2] as { items: Array<{ id: string }>; value: number };
    expect(params.items).toHaveLength(1);
    expect(params.items[0].id).toBe('11466');
    // The value still reflects the WHOLE cart, identified lines or not.
    expect(params.value).toBe(4999);
  });

  it('sends begin_checkout with value only when no line is identifiable', async () => {
    const gtag = installGtag();
    const { trackGoogleBeginCheckout } = await loadModule(ADS_ID);

    trackGoogleBeginCheckout(4999, [{ contentId: null }]);

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
