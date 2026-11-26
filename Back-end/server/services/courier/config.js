/**
 * Courier tracking sync — every number in one place, each with an env override.
 *
 * Read at CALL time (not import time) so a Railway variable change takes effect on
 * the next run after a restart, and tests can pass their own env object.
 */

/** The normalised courier states every adapter maps onto. */
export const COURIER_STATUS = Object.freeze({
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  FAILED: 'failed', // undelivered / RTO / lost / cancelled — a person must look
  UNKNOWN: 'unknown', // courier has no data, or a shape we do not recognise
});

const int = (v, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || v === '' || v === undefined || v === null) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const csv = (v) => String(v || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

/**
 * @param {object} [env=process.env]
 */
export function courierSyncConfig(env = process.env) {
  const e = env || {};
  return {
    /** Hard cap on parcels checked per run — the scan is bounded no matter what. */
    maxParcels: int(e.COURIER_SYNC_MAX_PARCELS, 150, { min: 1, max: 2000 }),
    /** Hard cap on orders READ per run, even when most parcels are skipped. */
    maxScanOrders: int(e.COURIER_SYNC_MAX_SCAN_ORDERS, 2000, { min: 1, max: 20_000 }),
    /** Orders read per keyset page. */
    pageSize: int(e.COURIER_SYNC_PAGE_SIZE, 50, { min: 1, max: 500 }),
    /** Pause between courier calls — polite to the courier's API, and to Shiprocket's limits. */
    delayMs: int(e.COURIER_SYNC_DELAY_MS, 400, { min: 0, max: 60_000 }),
    /** One parcel never holds the run longer than this. */
    timeoutMs: int(e.COURIER_SYNC_TIMEOUT_MS, 20_000, { min: 1_000, max: 120_000 }),
    /** A parcel checked more recently than this is skipped. */
    recheckMinutes: int(e.COURIER_SYNC_RECHECK_MINUTES, 60, { min: 0, max: 7 * 24 * 60 }),
    /** No courier scan for this long → `noMovementSince` is set. */
    noMovementHours: int(e.COURIER_SYNC_NO_MOVEMENT_HOURS, 48, { min: 1, max: 30 * 24 }),
    /** false → record what the courier says but never mark a parcel delivered. */
    autoDeliver: String(e.COURIER_SYNC_AUTO_DELIVER ?? 'true').toLowerCase() !== 'false',
    /**
     * Carrier codes (orderTrackingService CARRIERS) whose AWBs are booked through our
     * Shiprocket account, so Shiprocket can track them. `*` = every carrier. Empty =
     * Shiprocket tracking off (the default until bookings go through Shiprocket).
     */
    shiprocketCarriers: csv(e.COURIER_SYNC_SHIPROCKET_CARRIERS),
  };
}
