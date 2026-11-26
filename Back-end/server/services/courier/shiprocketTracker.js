/**
 * Shiprocket tracking adapter — `GET /courier/track/awb/{awb}`.
 *
 * Only AWBs booked through OUR Shiprocket account are known to it; any other AWB comes
 * back as "no activities found" and maps to `unknown`, never to a state that changes
 * the parcel. Which carriers to send here is COURIER_SYNC_SHIPROCKET_CARRIERS.
 *
 * Read-only call, so the client's one re-login on 401 is the only retry — nothing here
 * can double anything.
 *
 * DELIVERED IS STRICT: only Shiprocket's status code 7 ("DELIVERED"). Code 10 is
 * "RTO DELIVERED" — the parcel went BACK to us — and must never read as delivered,
 * which is why we do not pattern-match the word.
 */
import defaultClient from '../shiprocketClient.js';
import { COURIER_STATUS } from './config.js';

/** Shiprocket shipment_status codes → our states. Anything unlisted → unknown. */
const SR_STATUS = new Map([
  [7, COURIER_STATUS.DELIVERED],
  [17, COURIER_STATUS.OUT_FOR_DELIVERY],
  // in transit family: shipped, in transit, reached destination hub, picked up,
  // delayed, out for pickup, misrouted, in-transit at hubs…
  [6, COURIER_STATUS.IN_TRANSIT],
  [18, COURIER_STATUS.IN_TRANSIT],
  [19, COURIER_STATUS.IN_TRANSIT],
  [22, COURIER_STATUS.IN_TRANSIT],
  [38, COURIER_STATUS.IN_TRANSIT],
  [42, COURIER_STATUS.IN_TRANSIT],
  [48, COURIER_STATUS.IN_TRANSIT],
  // failed family: cancelled, RTO initiated, RTO delivered, lost, RTO acknowledged,
  // undelivered (failed attempt), damaged, destroyed
  [8, COURIER_STATUS.FAILED],
  [9, COURIER_STATUS.FAILED],
  [10, COURIER_STATUS.FAILED],
  [12, COURIER_STATUS.FAILED],
  [14, COURIER_STATUS.FAILED],
  [21, COURIER_STATUS.FAILED],
  [24, COURIER_STATUS.FAILED],
  [25, COURIER_STATUS.FAILED],
]);

/** "2026-11-17 14:20:00" (IST, no zone) → Date; ISO strings pass through. */
export function parseShiprocketDate(value) {
  if (!value || typeof value !== 'string') return null;
  const s = value.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/);
  const d = m ? new Date(`${m[1]}T${m[2]}${m[3] || ':00'}+05:30`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pure: Shiprocket's track body → the adapter contract. Exported for tests.
 * @returns {{status: string, lastScanAt: Date|null, deliveredAt: Date|null, events: Array}}
 */
export function normaliseShiprocketTracking(body) {
  const td = body?.tracking_data;
  const unknown = { status: COURIER_STATUS.UNKNOWN, lastScanAt: null, deliveredAt: null, events: [] };
  if (!td || typeof td !== 'object' || td.error) return unknown;

  const events = (Array.isArray(td.shipment_track_activities) ? td.shipment_track_activities : [])
    .map((a) => ({
      at: parseShiprocketDate(a?.date),
      status: String(a?.['sr-status-label'] || a?.activity || '').slice(0, 120),
      location: String(a?.location || '').slice(0, 120),
    }))
    .filter((ev) => ev.at)
    .sort((a, b) => b.at - a.at);

  const code = Number(td.shipment_status);
  const status = SR_STATUS.get(code) || COURIER_STATUS.UNKNOWN;
  const track = Array.isArray(td.shipment_track) ? td.shipment_track[0] : null;
  const deliveredAt = status === COURIER_STATUS.DELIVERED
    ? (parseShiprocketDate(track?.delivered_date) || events[0]?.at || null)
    : null;

  return { status, lastScanAt: events[0]?.at || null, deliveredAt, events: events.slice(0, 20) };
}

export function createShiprocketTracker({ client = defaultClient } = {}) {
  return {
    name: 'shiprocket',
    isConfigured: () => client.isConfigured(),
    async track(parcel) {
      const awb = String(parcel?.trackingNumber || '').trim();
      const body = await client.get(`/courier/track/awb/${encodeURIComponent(awb)}`);
      return normaliseShiprocketTracking(body);
    },
  };
}
