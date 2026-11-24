/**
 * Server-side geofence. The phone reports a position; only the server decides
 * whether that is inside one of the employee's allowed sites (haversine — the
 * allowed list is a handful of sites, so no geo index is needed).
 */
const EARTH_RADIUS_M = 6371008.8;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Faster than this between two punches is not a person travelling: someone else
 * is punching, or the location is spoofed. Generous (a flight is ~800 km/h, but
 * nobody flies between a clock-out and a clock-in at another branch).
 */
export const IMPOSSIBLE_SPEED_KMH = 200;
/** Below this distance GPS noise alone can look fast over a short interval. */
export const JUMP_MIN_DISTANCE_M = 5000;

/**
 * The fence verdict for one fix.
 *   { verdict: 'inside'|'anywhere_allowed'|'outside', site, distanceM }
 * `sites` are the employee's ACTIVE allowed sites ({ _id, lat, lng, radiusM }).
 */
export function fenceVerdict({ lat, lng }, sites, { anywhereAllowed = false } = {}) {
  let best = null;
  for (const s of sites || []) {
    const d = haversineM(lat, lng, s.lat, s.lng);
    if (!best || d - s.radiusM < best.d - best.site.radiusM) best = { site: s, d };
  }
  if (best && best.d <= best.site.radiusM) {
    return { verdict: 'inside', site: best.site._id, distanceM: Math.round(best.d) };
  }
  return {
    verdict: anywhereAllowed ? 'anywhere_allowed' : 'outside',
    site: null,
    distanceM: best ? Math.round(best.d) : null,
  };
}

/** True when going from `prev` ({lat,lng,at}) to `next` needs an impossible speed. */
export function isImpossibleJump(prev, next) {
  if (!prev || prev.lat == null || prev.lng == null) return false;
  const d = haversineM(prev.lat, prev.lng, next.lat, next.lng);
  if (d < JUMP_MIN_DISTANCE_M) return false;
  const hours = Math.abs(new Date(next.at) - new Date(prev.at)) / 3600000;
  if (hours === 0) return true;
  return d / 1000 / hours > IMPOSSIBLE_SPEED_KMH;
}
