/**
 * The "Delivery partner" courier list and its links (services/orderTrackingService.js).
 *
 * What must hold:
 *   - the dropdown offers exactly VRL, Delhivery, DTDC, Trackon, Shree Tirupati, Other — in that order
 *   - each opens the tracking page the owner gave (they don't take the number in the address)
 *   - a courier whose link has `{id}` gets the number put in, URL-encoded
 *   - "Other" takes a name and, optionally, an http(s) page; javascript:/data:/… are refused
 *   - a stored link is used only if it is http(s); parcels typed before the dropdown
 *     ("delhivery") still get their partner's link
 */

import orderTrackingService, {
  CARRIERS, DELIVERY_PARTNER_CODES, OTHER_CARRIER_CODE, safeHttpUrl,
} from '../../../services/orderTrackingService.js';

const OWNER_PAGES = {
  VRL: 'https://www.vrlgroup.in/Tracking/TrackShipment',
  DELHIVERY: 'https://www.delhivery.com/tracking',
  DTDC: 'https://www.dtdc.com/track-your-shipment/',
  TRACKON: 'https://www.trackon.in/',
  SHREE_TIRUPATI: 'https://www.shreetirupaticourier.net/',
};

describe('delivery partner list', () => {
  it('offers the five partners and Other, in order', () => {
    expect(DELIVERY_PARTNER_CODES).toEqual(['VRL', 'DELHIVERY', 'DTDC', 'TRACKON', 'SHREE_TIRUPATI', OTHER_CARRIER_CODE]);
    const listed = orderTrackingService.getSupportedCarriers().filter((c) => c.deliveryPartner);
    expect(listed.map((c) => c.name)).toEqual(['VRL', 'Delhivery', 'DTDC', 'Trackon', 'Shree Tirupati Courier', 'Other courier']);
    // The admin's list still has every carrier, and only the partners are flagged.
    expect(orderTrackingService.getSupportedCarriers().find((c) => c.code === 'FEDEX').deliveryPartner).toBeUndefined();
  });

  it.each(Object.entries(OWNER_PAGES))('%s opens its tracking page (no number in the address)', (code, page) => {
    const { carrier } = orderTrackingService.resolveCarrier(code);
    expect(orderTrackingService.buildCarrierSubdoc(carrier, 'AWB123')).toEqual({ name: CARRIERS[code].name, code, trackingUrl: page });
  });

  it('puts the number in a link that has {id}, URL-encoded', () => {
    const { carrier } = orderTrackingService.resolveCarrier('FEDEX');
    expect(orderTrackingService.buildCarrierSubdoc(carrier, '1234 5678').trackingUrl)
      .toBe('https://www.fedex.com/fedextrack/?trknbr=1234%205678');
    // No number yet → no link to a half-built address.
    expect(orderTrackingService.buildCarrierSubdoc(carrier, '')).toEqual({ name: 'FedEx', code: 'FEDEX' });
  });
});

describe('Other: name + optional tracking page', () => {
  it('stores the typed name and page as given', () => {
    const { carrier, error } = orderTrackingService.resolveCarrier('OTHER', '  Professional Couriers ', ' https://tpcindia.com/track ');
    expect(error).toBeNull();
    expect(orderTrackingService.buildCarrierSubdoc(carrier, 'P1'))
      .toEqual({ name: 'Professional Couriers', code: 'OTHER', trackingUrl: 'https://tpcindia.com/track' });
  });

  it('works with no page — no link stored', () => {
    const { carrier } = orderTrackingService.resolveCarrier('OTHER', 'Local van');
    expect(orderTrackingService.buildCarrierSubdoc(carrier, 'X1')).toEqual({ name: 'Local van', code: 'OTHER' });
  });

  it('still needs the name', () => {
    expect(orderTrackingService.resolveCarrier('OTHER', '  ', 'https://a.in').carrier).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://files.example.com/track',
    'file:///etc/passwd',
    '//evil.example.com/track',
    'www.courier.in/track',
    'https://user:pass@courier.in/track',
    `https://courier.in/${'a'.repeat(600)}`,
  ])('refuses %s as a tracking page', (url) => {
    const { carrier, error } = orderTrackingService.resolveCarrier('OTHER', 'Courier', url);
    expect(carrier).toBeNull();
    expect(error).toMatch(/http:\/\/ or https:\/\//);
  });
});

describe('safeHttpUrl', () => {
  it('keeps http and https links', () => {
    expect(safeHttpUrl('https://a.in/t?x=1')).toBe('https://a.in/t?x=1');
    expect(safeHttpUrl('http://a.in')).toBe('http://a.in/');
  });
  it('drops everything else', () => {
    for (const v of [null, undefined, '', 42, 'javascript:x', 'mailto:a@b.in', 'nonsense']) expect(safeHttpUrl(v)).toBeNull();
  });
});

describe('trackingLinkFor — what the link icon opens', () => {
  it('uses a stored http(s) link', () => {
    expect(orderTrackingService.trackingLinkFor({ name: 'X', code: 'OTHER', trackingUrl: 'https://x.in/t' }, '1')).toBe('https://x.in/t');
  });
  it('never hands out a stored link that is not http(s)', () => {
    expect(orderTrackingService.trackingLinkFor({ name: 'X', code: 'OTHER', trackingUrl: 'javascript:alert(1)' }, '1')).toBeNull();
  });
  it('falls back to the partner by code, then by the name typed before the dropdown', () => {
    expect(orderTrackingService.trackingLinkFor({ name: 'VRL', code: 'VRL' }, '1')).toBe(OWNER_PAGES.VRL);
    expect(orderTrackingService.trackingLinkFor({ name: '  delhivery ' }, 'DL1')).toBe(OWNER_PAGES.DELHIVERY);
    expect(orderTrackingService.trackingLinkFor({ name: 'Shree  Tirupati Courier' }, '1')).toBe(OWNER_PAGES.SHREE_TIRUPATI);
  });
  it('is null for an unknown courier, or none at all', () => {
    expect(orderTrackingService.trackingLinkFor({ name: 'Ram Transport' }, '1')).toBeNull();
    expect(orderTrackingService.trackingLinkFor({ name: 'Other courier' }, '1')).toBeNull();
    expect(orderTrackingService.trackingLinkFor(undefined, '')).toBeNull();
  });
});
