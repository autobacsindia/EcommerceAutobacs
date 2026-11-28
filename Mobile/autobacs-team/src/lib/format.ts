/** Display-only formatting. The server computes every figure; we only print it. */

/** 2784000 paise → '₹27,840' (Indian grouping, paise shown only when non-zero). */
export function formatPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${neg ? '−' : ''}₹${grouped}${p ? `.${String(p).padStart(2, '0')}` : ''}`;
}

/** 9 half-days → '4.5' ; 12 → '6' */
export function halfDaysToDays(halfDays: number): string {
  const d = halfDays / 2;
  return Number.isInteger(d) ? String(d) : d.toFixed(1);
}

/** 'Inside Main showroom (40 m)'-style distance in metres between two points. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
