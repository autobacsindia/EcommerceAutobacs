/**
 * Courier adapters — pure parsing + HTTP behaviour, all HTTP mocked.
 * The rule that matters most: nothing that is not unambiguously "delivered" may
 * ever read as delivered (RTO delivered, undelivered, unknown shapes).
 */
import { jest } from '@jest/globals';
import {
  normaliseShiprocketTracking, parseShiprocketDate, createShiprocketTracker,
} from '../../../services/courier/shiprocketTracker.js';
import {
  normaliseDtdcTracking, dtdcStatusFromText, parseDtdcDate, createDtdcTracker,
} from '../../../services/courier/dtdcTracker.js';
import { courierSyncConfig } from '../../../services/courier/config.js';

describe('Shiprocket tracking', () => {
  const body = (shipment_status, extra = {}) => ({
    tracking_data: {
      track_status: 1,
      shipment_status,
      shipment_track: [{ awb_code: 'A1', current_status: 'X', delivered_date: '2026-11-17 14:20:00' }],
      shipment_track_activities: [
        { date: '2026-11-16 09:00:00', 'sr-status-label': 'IN TRANSIT', location: 'Delhi' },
        { date: '2026-11-17 14:20:00', 'sr-status-label': 'DELIVERED', location: 'Kochi' },
      ],
      ...extra,
    },
  });

  it('7 → delivered with the courier delivery time (IST)', () => {
    const r = normaliseShiprocketTracking(body(7));
    expect(r.status).toBe('delivered');
    expect(r.deliveredAt.toISOString()).toBe('2026-11-17T08:50:00.000Z');
    expect(r.lastScanAt.toISOString()).toBe('2026-11-17T08:50:00.000Z');
    expect(r.events[0].location).toBe('Kochi');
  });

  it.each([[10, 'failed'], [9, 'failed'], [21, 'failed'], [17, 'out_for_delivery'], [18, 'in_transit'], [999, 'unknown']])(
    'status %s → %s (RTO delivered is NOT delivered)', (code, expected) => {
      const r = normaliseShiprocketTracking(body(code));
      expect(r.status).toBe(expected);
      expect(r.deliveredAt).toBeNull();
    });

  it('AWB not in our account → unknown', () => {
    expect(normaliseShiprocketTracking({ tracking_data: { track_status: 0, shipment_status: 0, error: 'Aahh! There is no activities found in our DB for this AWB.' } }).status).toBe('unknown');
    expect(normaliseShiprocketTracking(null).status).toBe('unknown');
  });

  it('parses dates', () => {
    expect(parseShiprocketDate('bad')).toBeNull();
    expect(parseShiprocketDate('2026-11-17T08:50:00Z').toISOString()).toBe('2026-11-17T08:50:00.000Z');
  });

  it('tracker calls the AWB endpoint through the client (errors propagate)', async () => {
    const client = { isConfigured: () => true, get: jest.fn(async () => body(18)) };
    const t = createShiprocketTracker({ client });
    expect((await t.track({ trackingNumber: ' A 1 ' })).status).toBe('in_transit');
    expect(client.get).toHaveBeenCalledWith('/courier/track/awb/A%201');

    client.get.mockRejectedValueOnce(Object.assign(new Error('Shiprocket error (HTTP 502)'), { status: 502 }));
    await expect(t.track({ trackingNumber: 'A1' })).rejects.toThrow('502');
  });
});

describe('DTDC tracking', () => {
  const body = (strStatus, extra = {}) => ({
    statusCode: 200, statusFlag: true, status: 'SUCCESS',
    trackHeader: { strShipmentNo: 'R1002402870', strStatus, strStatusTransOn: '17112026', strStatusTransTime: '1530' },
    trackDetails: [
      { strCode: 'BKD', strAction: 'Booked', strActionDate: '14112026', strActionTime: '1100', strOrigin: 'Delhi' },
      { strCode: 'IT', strAction: 'In Transit', strActionDate: '15112026', strActionTime: '0900', strOrigin: 'Bengaluru' },
    ],
    ...extra,
  });

  it('Delivered → delivered at the header time', () => {
    const r = normaliseDtdcTracking(body('Delivered'));
    expect(r.status).toBe('delivered');
    expect(r.deliveredAt.toISOString()).toBe('2026-11-17T10:00:00.000Z');
    expect(r.lastScanAt.toISOString()).toBe('2026-11-17T10:00:00.000Z');
  });

  it.each([
    ['RTO Delivered', 'failed'], ['Not Delivered', 'failed'], ['Undelivered', 'failed'], ['Delivery Attempted', 'failed'],
    ['Out For Delivery', 'out_for_delivery'], ['In Transit', 'in_transit'], ['Booked', 'in_transit'], ['', 'unknown'], ['Something new', 'unknown'],
  ])('%s → %s', (text, expected) => {
    expect(dtdcStatusFromText(text)).toBe(expected);
  });

  it('statusFlag false / missing header → unknown', () => {
    expect(normaliseDtdcTracking({ statusFlag: false, errorDetails: [{ name: 'strError', value: 'Invalid' }] }).status).toBe('unknown');
    expect(normaliseDtdcTracking({}).status).toBe('unknown');
    expect(parseDtdcDate('2026-11-17', '1530')).toBeNull();
  });

  const res = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text });

  it('is off until credentials exist', () => {
    expect(createDtdcTracker({ env: () => ({}) }).isConfigured()).toBe(false);
    expect(createDtdcTracker({ env: () => ({ DTDC_TRACKING_USERNAME: 'u', DTDC_TRACKING_PASSWORD: 'p' }) }).isConfigured()).toBe(true);
    expect(createDtdcTracker({ env: () => ({ DTDC_TRACKING_ACCESS_TOKEN: 't' }) }).isConfigured()).toBe(true);
  });

  it('authenticates once, sends the token, re-authenticates once on 401', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(res(200, 'TOKEN1'))
      .mockResolvedValueOnce(res(200, JSON.stringify(body('In Transit'))))
      .mockResolvedValueOnce(res(401, ''))
      .mockResolvedValueOnce(res(200, 'TOKEN2'))
      .mockResolvedValueOnce(res(200, JSON.stringify(body('Delivered'))));
    const t = createDtdcTracker({ env: () => ({ DTDC_TRACKING_USERNAME: 'u', DTDC_TRACKING_PASSWORD: 'p' }), fetchImpl });

    expect((await t.track({ trackingNumber: 'R1002402870' })).status).toBe('in_transit');
    const [authUrl] = fetchImpl.mock.calls[0];
    expect(authUrl).toContain('/api/dtdc/authenticate');
    const [trackUrl, init] = fetchImpl.mock.calls[1];
    expect(trackUrl).toContain('/rest/JSONCnTrk/getTrackDetails');
    expect(init.headers['X-Access-Token']).toBe('TOKEN1');
    expect(JSON.parse(init.body)).toEqual({ trkType: 'cnno', strcnno: 'R1002402870', addtnlDtl: 'Y' });

    expect((await t.track({ trackingNumber: 'R1002402870' })).status).toBe('delivered');
    expect(fetchImpl.mock.calls[4][1].headers['X-Access-Token']).toBe('TOKEN2');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('5xx / non-JSON / failed login throw (never a status), and the password never appears in the error', async () => {
    const env = () => ({ DTDC_TRACKING_USERNAME: 'u', DTDC_TRACKING_PASSWORD: 'secret-pw' });
    const t1 = createDtdcTracker({ env, fetchImpl: jest.fn().mockResolvedValueOnce(res(200, 'T')).mockResolvedValueOnce(res(503, 'down')) });
    await expect(t1.track({ trackingNumber: 'A' })).rejects.toThrow('HTTP 503');

    const t2 = createDtdcTracker({ env, fetchImpl: jest.fn().mockResolvedValueOnce(res(200, 'T')).mockResolvedValueOnce(res(200, '<html>')) });
    await expect(t2.track({ trackingNumber: 'A' })).rejects.toThrow('non-JSON');

    const t3 = createDtdcTracker({ env, fetchImpl: jest.fn().mockResolvedValueOnce(res(403, 'no')) });
    const err = await t3.track({ trackingNumber: 'A' }).catch((e) => e);
    expect(err.code).toBe('AUTH_FAILED');
    expect(err.message).not.toContain('secret-pw');

    const t4 = createDtdcTracker({ env, fetchImpl: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'TimeoutError' })) });
    expect((await t4.track({ trackingNumber: 'A' }).catch((e) => e)).code).toBe('TIMEOUT');
  });
});

describe('courierSyncConfig', () => {
  it('defaults and clamps', () => {
    const c = courierSyncConfig({});
    expect(c).toMatchObject({ maxParcels: 150, noMovementHours: 48, autoDeliver: true, shiprocketCarriers: [] });
    expect(courierSyncConfig({ COURIER_SYNC_MAX_PARCELS: '999999', COURIER_SYNC_SHIPROCKET_CARRIERS: 'dtdc, delhivery' }))
      .toMatchObject({ maxParcels: 2000, shiprocketCarriers: ['DTDC', 'DELHIVERY'] });
  });
});
