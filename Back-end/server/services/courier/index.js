/**
 * Courier tracking — one interface, one adapter per courier.
 *
 *   tracker.track(parcel) → { status: in_transit|out_for_delivery|delivered|failed|unknown,
 *                             lastScanAt: Date|null, deliveredAt: Date|null, events[] }
 *
 * `resolveTracker` picks the adapter for a parcel, or says why there is none — the
 * parcel then stays fully manual (staff mark it delivered as today).
 */
import { CARRIERS, OTHER_CARRIER_CODE, carrierByName } from '../orderTrackingService.js';
import { courierSyncConfig } from './config.js';
import { createShiprocketTracker } from './shiprocketTracker.js';
import { createDtdcTracker } from './dtdcTracker.js';

export { COURIER_STATUS, courierSyncConfig } from './config.js';

/** Lazily built so importing this module never touches Redis or the network. */
let defaults = null;
export function defaultTrackers() {
  if (!defaults) defaults = { dtdc: createDtdcTracker(), shiprocket: createShiprocketTracker() };
  return defaults;
}

/** The built-in carrier code for a parcel (free-text "Other: DTDC" resolves too). */
export function carrierCodeOf(parcel) {
  const code = String(parcel?.carrier?.code || '').trim().toUpperCase();
  if (code && code !== OTHER_CARRIER_CODE && CARRIERS[code]) return code;
  return carrierByName(parcel?.carrier?.name)?.code || null;
}

/**
 * @returns {{ tracker: object, carrier: string } | { skip: 'no_awb'|'unknown_courier'|'not_configured', carrier: string|null }}
 */
export function resolveTracker(parcel, { trackers = defaultTrackers(), config = courierSyncConfig() } = {}) {
  const carrier = carrierCodeOf(parcel);
  if (!String(parcel?.trackingNumber || '').trim()) return { skip: 'no_awb', carrier };
  if (!carrier) return { skip: 'unknown_courier', carrier: null };

  if (carrier === 'DTDC' && trackers.dtdc?.isConfigured()) return { tracker: trackers.dtdc, carrier };

  const sr = config.shiprocketCarriers;
  if ((sr.includes('*') || sr.includes(carrier)) && trackers.shiprocket?.isConfigured()) {
    return { tracker: trackers.shiprocket, carrier };
  }
  return { skip: carrier === 'DTDC' || sr.includes(carrier) || sr.includes('*') ? 'not_configured' : 'unknown_courier', carrier };
}
