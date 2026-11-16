/**
 * India Post "All India Pincode Directory" CSV → one location per PIN.
 * Pure (no I/O) so the import script's parsing is unit-tested.
 *
 * The directory has one row per POST OFFICE (~1.6 lakh rows, ~19k PINs), with
 * lat/long often missing ("NA") or wrong (swapped, 0, outside India). Per PIN we keep
 * the MEDIAN of the valid coordinates — one bad office cannot drag a PIN across the
 * country — and the district/state of its first delivery office.
 */

const INDIA = { latMin: 6, latMax: 38, lngMin: 68, lngMax: 98 };
const inIndia = (lat, lng) => lat >= INDIA.latMin && lat <= INDIA.latMax && lng >= INDIA.lngMin && lng <= INDIA.lngMax;

/** Minimal RFC-4180 line split (quoted fields with commas / doubled quotes). */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const titleCase = (v) => (v ? v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null);

/**
 * @param {string} text  whole CSV file
 * @returns {{ rows: Array<{pin,lat,lng,district,state}>, stats: object }}
 */
export function parsePinDirectory(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('empty file');
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const col = (...names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0);
  const iPin = col('pincode', 'pin');
  const iLat = col('latitude', 'lat');
  const iLng = col('longitude', 'long', 'lng');
  const iDistrict = col('district', 'districtname');
  const iState = col('statename', 'state');
  const iDelivery = col('delivery', 'deliverystatus');
  if ([iPin, iLat, iLng].some((i) => i === undefined)) {
    throw new Error('CSV must have pincode, latitude and longitude columns');
  }

  const byPin = new Map();
  let bad = 0;
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const pin = (f[iPin] || '').replace(/\D/g, '');
    if (!/^[1-9]\d{5}$/.test(pin)) { bad += 1; continue; }
    let entry = byPin.get(pin);
    if (!entry) { entry = { lats: [], lngs: [], district: null, state: null, delivery: false }; byPin.set(pin, entry); }
    const lat = Number(f[iLat]);
    const lng = Number(f[iLng]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      if (inIndia(lat, lng)) { entry.lats.push(lat); entry.lngs.push(lng); } else if (inIndia(lng, lat)) { entry.lats.push(lng); entry.lngs.push(lat); }
    }
    const isDelivery = iDelivery !== undefined && /^delivery$/i.test(f[iDelivery] || '');
    if (!entry.district || (isDelivery && !entry.delivery)) {
      entry.district = titleCase(f[iDistrict]) || entry.district;
      entry.state = titleCase(f[iState]) || entry.state;
      entry.delivery = entry.delivery || isDelivery;
    }
  }

  const rows = [];
  let noCoords = 0;
  for (const [pin, e] of byPin) {
    if (!e.lats.length) { noCoords += 1; continue; }
    rows.push({
      pin,
      lat: Math.round(median(e.lats) * 1e5) / 1e5,
      lng: Math.round(median(e.lngs) * 1e5) / 1e5,
      district: e.district ? e.district.slice(0, 80) : null,
      state: e.state ? e.state.slice(0, 60) : null,
    });
  }
  rows.sort((a, b) => a.pin.localeCompare(b.pin));
  return { rows, stats: { lines: lines.length - 1, badPinLines: bad, pins: byPin.size, located: rows.length, noCoords } };
}
