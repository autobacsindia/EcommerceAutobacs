/**
 * Delivery fees — the PURE maths. No DB, no clock, no I/O: everything it needs is
 * passed in, so the same inputs always give the same paise and tests can pin it.
 *
 * Every fee is derived from a real cost on the owner's courier bills (Air Line
 * Express / Delhivery / DTDC / Gati agent, VRL, Trackon). That is a legal
 * requirement, not a style choice: under the CCPA dark-patterns guidelines (2023) a
 * fee a customer actually pays must not be invented. So there is no "round up to a
 * nice number" anywhere below, and every rate lives in the admin rate card.
 *
 *   charged kg   = max(actual kg, L×W×H ÷ divisor) per unit, × qty, summed per cart
 *   ≤ courierMaxKg  → COURIER parcel: slab rate per started slab (0.5 kg); the
 *                     rate is the distance band's own, else the card-wide one
 *   >  courierMaxKg → FREIGHT: ₹/kg with a minimum, plus docket + other + fuel and
 *                     hamali per kg (fixed charges once per shipment)
 *   packing      = per-unit box/crate cost for the product's size class
 *   remote area  = the courier's ODA charge, only for a PIN on the stored list
 *   insurance    = % of the goods value (VRL "freight on value")
 *   payment fee  = the Razorpay MDR (+ GST on it) on what the customer pays
 *   GST on fees  = optional, at the configured rate (composite supply — the
 *                  accountant decides; admin toggle)
 *
 * Money is integer paise throughout; rates are rupees in the card and converted once.
 */

import {
  isCompleteSize,
  boxFromListedSize,
  DEFAULT_CLASS_BOXES,
  SHIPPING_CLASS_MAX_KG,
} from './shippingClass.js';

/** Fee lines, in the order they are shown. `code` is the stable key stored on orders. */
export const FEE_LINES = Object.freeze([
  { code: 'shipping', label: 'Shipping fee' },
  { code: 'packing', label: 'Packing fee' },
  { code: 'handling', label: 'Handling fee' },
  { code: 'docket', label: 'Docket / Processing fee' },
  { code: 'fuel', label: 'Fuel surcharge' },
  { code: 'remote', label: 'Remote area fee' },
  { code: 'insurance', label: 'Insurance fee' },
  { code: 'payment', label: 'Platform / Payment fee' },
  { code: 'gst', label: 'GST on fees' },
]);
export const FEE_CODES = Object.freeze(FEE_LINES.map((l) => l.code));
const LABEL = Object.fromEntries(FEE_LINES.map((l) => [l.code, l.label]));

/** Where a line's box came from. Anything but `measured` is an estimate. */
export const BOX_SOURCES = Object.freeze(['measured', 'listed', 'class', 'fallback']);

/**
 * Starting rate card, from the owner's real bills (2026-11). Admin-editable
 * (DeliveryFeeConfig). Rupees; per-kg rates may have paise.
 */
export const DEFAULT_RATE_CARD = Object.freeze({
  chargeAtCheckout: false,          // go-live switch: off = today's "paid on delivery"
  volumetricDivisor: 4500,          // cm³ per kg, from the Air Line Express bill
  courier: Object.freeze({
    maxKg: 10,                      // above this a parcel goes as freight
    slabKg: 0.5,
    slabRate: 80,                   // ₹ per started 0.5 kg (Delhivery/Trackon small parcels)
  }),
  freight: Object.freeze({
    minimum: 500,
    docket: 100,
    otherCharges: 50,
    fuel: 30,
    hamaliPerKg: 0.45,              // VRL hamali
  }),
  // Where parcels leave from. Distance = straight-line km (haversine) to the
  // delivery PIN's India Post lat/long.
  origin: Object.freeze({ label: 'Delhi', pin: '110001', lat: 28.6139, lng: 77.209 }),
  // Freight ₹/kg by distance. Last band is open-ended (upToKm null) and is also used
  // when a PIN's location is unknown. All ₹16 today: the owner's bills charged the
  // same for Hyderabad, West Bengal and Punjab (Air Line Express; VRL ₹13.10).
  distanceBands: Object.freeze([
    Object.freeze({ upToKm: 500, ratePerKg: 16 }),
    Object.freeze({ upToKm: 1000, ratePerKg: 16 }),
    Object.freeze({ upToKm: 1500, ratePerKg: 16 }),
    Object.freeze({ upToKm: 2000, ratePerKg: 16 }),
    Object.freeze({ upToKm: null, ratePerKg: 16 }),
  ]),
  packing: Object.freeze({          // ₹ per unit, by size class (box / wooden crate)
    small: 20,
    medium: 60,
    large: 500,
    xl: 1500,
  }),
  remoteAreaFee: 750,               // ODA, e.g. Jalpaiguri
  insurancePercent: 0.1,            // freight-on-value
  paymentFeePercent: 2,             // Razorpay standard MDR
  paymentFeeGstPercent: 18,         // GST Razorpay charges on its MDR (see the payment fee note below)
  paymentFeeMax: 999,               // ₹ cap on the payment fee; 0 = no cap. A ₹5,05,000 kit at 2% is ₹10,100.
  // Standard XL crate when an XL product has no measured box. From the owner's
  // Hyderabad bill: 208×70×85 cm → 276 kg chargeable at /4500.
  xlBox: Object.freeze({ weightKg: 60, lengthCm: 208, breadthCm: 70, heightCm: 85 }),
  gstOnFees: Object.freeze({ enabled: true, percent: 18 }),
});

const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);

/** Size class for packing when a product has none stored: from its box's chargeable kg. */
function classForKg(kg) {
  if (kg <= SHIPPING_CLASS_MAX_KG.small) return 'small';
  if (kg <= SHIPPING_CLASS_MAX_KG.medium) return 'medium';
  if (kg <= SHIPPING_CLASS_MAX_KG.large) return 'large';
  return 'xl';
}

/**
 * The packed box for one product, best source first:
 *   measured `shippingSize` → online `listedSize` + packing margin → the stored class's
 *   standard box → the class guessed from its CATEGORY (utils/categoryShippingClass.js)
 *   → the Small box (only when there is no category signal at all).
 * XL has no admin standard box, so it uses the rate card's `xlBox` crate. Every source
 * but `measured` marks the quote as estimated so admin knows to measure the product.
 *
 * Why the category step: with no size data a body kit used to be priced as a ½ kg
 * parcel (₹320 shipping to Kochi). The category is always known and is a far better
 * estimate of the real courier cost than the smallest box.
 *
 * @param {{ shippingSize?, listedSize?, shippingClass?, categoryClass? }} product
 * @param {{ small, medium, large }} classBoxes  admin standard boxes
 * @param {{ weightKg, lengthCm, breadthCm, heightCm }} [xlBox]  standard XL crate
 * @returns {{ box: {weightKg,lengthCm,breadthCm,heightCm}, source: string, cls: string|null }}
 */
export function resolveBox(product, classBoxes = DEFAULT_CLASS_BOXES, xlBox = DEFAULT_RATE_CARD.xlBox) {
  if (isCompleteSize(product?.shippingSize)) return { box: product.shippingSize, source: 'measured', cls: null };
  const listed = boxFromListedSize(product?.listedSize);
  if (listed) return { box: listed, source: 'listed', cls: null };
  const boxOf = (cls) => (cls === 'xl' ? xlBox : classBoxes[cls]);
  const stored = product?.shippingClass;
  if (stored === 'small' || stored === 'medium' || stored === 'large' || stored === 'xl') {
    return { box: boxOf(stored), source: 'class', cls: stored };
  }
  const guessed = product?.categoryClass;
  if (guessed === 'small' || guessed === 'medium' || guessed === 'large' || guessed === 'xl') {
    return { box: boxOf(guessed), source: 'category', cls: guessed };
  }
  return { box: classBoxes.small, source: 'fallback', cls: null };
}

/** max(actual, volumetric) for ONE unit, in kg (unrounded). */
export function unitChargedKg(box, divisor) {
  const vol = (box.lengthCm * box.breadthCm * box.heightCm) / divisor;
  return Math.max(box.weightKg, vol);
}

/**
 * The distance band for a distance. Unknown distance (PIN not in the location table)
 * → the LAST (highest, open-ended) band: never under-quote a parcel we cannot place.
 */
export function bandFor(distanceKm, bands) {
  if (!Array.isArray(bands) || bands.length === 0) throw new TypeError('distanceBands required');
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) return bands[bands.length - 1];
  return bands.find((b) => b.upToKm == null || distanceKm <= b.upToKm) || bands[bands.length - 1];
}

const EARTH_RADIUS_KM = 6371;
/** Straight-line km between two {lat, lng} points (haversine), rounded to whole km. */
export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Percent of an amount in paise, rounded to the nearest paisa. */
const pct = (paise, percent) => Math.round((paise * Number(percent || 0)) / 100);

/**
 * Compute the delivery fees for a cart.
 *
 * @param {object} args
 * @param {Array<{ quantity:number, product:{ shippingSize?, listedSize?, shippingClass? } }>} args.lines
 * @param {number}  args.goodsPaise   what the customer pays for the goods (after discounts)
 * @param {boolean|null} args.isRemote  true/false once a PIN is known; null = no PIN yet
 * @param {number|null} [args.distanceKm] km from the origin; null = unknown (highest band)
 * @param {object}  args.card         rate card (DEFAULT_RATE_CARD shape)
 * @param {object}  [args.classBoxes] admin standard boxes
 * @returns {{
 *   mode: 'courier'|'freight', chargedKg: number, lines: Array<{code,label,amountPaise}>,
 *   totalPaise: number, estimated: boolean, boxSources: string[]
 * }}
 */
export function computeDeliveryFees({ lines, goodsPaise, isRemote = null, distanceKm = null, card = DEFAULT_RATE_CARD, classBoxes = DEFAULT_CLASS_BOXES }) {
  if (!Array.isArray(lines) || lines.length === 0) throw new TypeError('lines required');
  if (!Number.isInteger(goodsPaise) || goodsPaise < 0) throw new TypeError('goodsPaise must be whole paise');

  let rawKg = 0;
  let packingPaise = 0;
  const boxSources = [];
  for (const line of lines) {
    const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
    const { box, source, cls: boxClass } = resolveBox(line.product, classBoxes, card.xlBox || DEFAULT_RATE_CARD.xlBox);
    const kg = unitChargedKg(box, card.volumetricDivisor);
    rawKg += kg * qty;
    // Packing follows the stored class (also when the box is measured), then the class
    // that chose the box (category guess), else the box's own weight.
    const cls = line.product?.shippingClass || boxClass || classForKg(kg);
    packingPaise += toPaise(card.packing[cls]) * qty;
    boxSources.push(source);
  }

  const amounts = Object.fromEntries(FEE_CODES.map((c) => [c, 0]));
  const band = bandFor(distanceKm, card.distanceBands);
  let mode;
  let chargedKg;
  if (rawKg <= card.courier.maxKg) {
    mode = 'courier';
    const slabs = Math.max(1, Math.ceil(round6(rawKg / card.courier.slabKg)));
    chargedKg = round6(slabs * card.courier.slabKg);
    amounts.shipping = slabs * toPaise(slabRateFor(band, card));
  } else {
    mode = 'freight';
    chargedKg = Math.ceil(round6(rawKg));
    amounts.shipping = Math.max(toPaise(card.freight.minimum), chargedKg * toPaise(band.ratePerKg));
    amounts.handling = Math.round(chargedKg * card.freight.hamaliPerKg * 100);
    amounts.docket = toPaise(card.freight.docket) + toPaise(card.freight.otherCharges);
    amounts.fuel = toPaise(card.freight.fuel);
  }
  amounts.packing = packingPaise;
  amounts.remote = isRemote === true ? toPaise(card.remoteAreaFee) : 0;
  amounts.insurance = pct(goodsPaise, card.insurancePercent);

  const beforePayment = sum(amounts);
  // Payment fee: Razorpay's MDR on what passes through it (goods + the fees above).
  //
  // GST is charged ONCE. Razorpay bills its MDR plus 18% GST; that GST is input tax we
  // claim back, so when we charge "GST on fees" the payment fee is the MDR alone and
  // our single GST line covers it. Adding Razorpay's GST into the fee AND then 18% on
  // top taxed the same rupee twice (₹11,938 fee + ₹2,301 GST on a ₹5,05,000 kit).
  // With GST on fees switched off there is no output GST to carry it, so the fee keeps
  // Razorpay's GST as part of the real cost.
  const gstOnFees = Boolean(card.gstOnFees?.enabled);
  const mdrPercent = Number(card.paymentFeePercent || 0)
    * (gstOnFees ? 1 : 1 + Number(card.paymentFeeGstPercent || 0) / 100);
  amounts.payment = pct(goodsPaise + beforePayment, mdrPercent);
  // Owner's cap: a percentage of a ₹5 lakh kit is not a delivery cost a customer
  // should see. 0 / unset = no cap.
  const capPaise = toPaise(card.paymentFeeMax);
  if (capPaise > 0) amounts.payment = Math.min(amounts.payment, capPaise);

  if (gstOnFees) {
    amounts.gst = pct(sum(amounts), card.gstOnFees.percent);
  }

  const out = FEE_CODES
    .filter((code) => amounts[code] > 0)
    .map((code) => ({ code, label: LABEL[code], amountPaise: amounts[code] }));
  return {
    mode,
    chargedKg,
    lines: out,
    totalPaise: sum(amounts),
    estimated: boxSources.some((s) => s !== 'measured'),
    boxSources,
    band: { upToKm: band.upToKm ?? null, ratePerKg: band.ratePerKg, slabRate: slabRateFor(band, card) },
  };
}

/**
 * Small-parcel (courier) ₹ per slab for a band. A band may set its own rate — couriers
 * charge far zones more — and a band that leaves it blank (null) uses the card-wide
 * `courier.slabRate`, so an old card prices exactly as before.
 */
export function slabRateFor(band, card) {
  return typeof band?.slabRate === 'number' && Number.isFinite(band.slabRate) ? band.slabRate : card.courier.slabRate;
}

function sum(amounts) {
  return Object.values(amounts).reduce((a, b) => a + b, 0);
}

/** Kill float noise (0.30000000000000004) before ceil, so 10 kg never bills as 11. */
function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

export const isValidPin = (pin) => typeof pin === 'string' && /^[1-9]\d{5}$/.test(pin);

export default { computeDeliveryFees, bandFor, slabRateFor, haversineKm, resolveBox, unitChargedKg, DEFAULT_RATE_CARD, FEE_LINES, FEE_CODES, isValidPin };
