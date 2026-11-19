/**
 * Delivery fees at checkout — rate card, remote PINs and the per-quote fee block.
 *
 * Two reads, like festivalOfferService:
 *   - PRICING (getRateCard / quoteDeliveryFees): uncached Mongo reads, so a rate
 *     change or the Black Friday switch flipping off prices the very next quote.
 *   - DISPLAY (resolvePublicDeliveryFeeConfig): cached 60 s, purged on every write;
 *     tells the storefront whether fees are on and whether the offer button exists.
 *     Never used to price anything.
 *
 * The maths is utils/deliveryFees.js (pure). This file only gathers its inputs.
 */

import deliveryFeeRepository from '../repositories/deliveryFeeRepository.js';
import { getClassBoxes } from './shippingClassService.js';
import { isDeliveryFeeOfferLive, isDeliveryFeeOfferLiveForPricing } from './festivalOfferService.js';
import * as festivalThemeService from './festivalThemeService.js';
import festivalOfferRepository from '../repositories/festivalOfferRepository.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from './frontendRevalidator.js';
import { festivalOfferTags } from '../utils/nextTags.js';
import cacheService, { CACHE_VERSION } from './cacheService.js';
import auditLogger from './auditLogger.js';
import AppError from '../utils/AppError.js';
import { computeDeliveryFees, DEFAULT_RATE_CARD, isValidPin, haversineKm } from '../utils/deliveryFees.js';
import { classFromCategorySlugs, slugsWithAncestors } from '../utils/categoryShippingClass.js';
import { fromPaise } from '../utils/money.js';

/** Snapshotted on orders; follows the event the owner runs (Black Friday 2026). */
export const DELIVERY_FEE_OFFER_CODE = 'blackfriday';

export const DELIVERY_FEE_CACHE_TAG = 'public:delivery-fees';
const CACHE_KEY = `${CACHE_VERSION}:${DELIVERY_FEE_CACHE_TAG}`;
const CACHE_TTL_SECONDS = 60;

export const MAX_REMOTE_PINS_PER_UPLOAD = 20000;
export const MAX_REMOTE_PIN_PAGE = 200;

/** Reason codes the client can act on (quote.deliveryFees.offer.error). */
export const OFFER_ERROR = Object.freeze({ ENDED: 'offer_ended' });

const fail = (message, status = 400, extra = {}) => new AppError(message, status, { expose: true, ...extra });

/*
  ── The Black Friday event gate ───────────────────────────────────────────────
  Agreed with the theme work (feat/black-friday-theme): the fee offer is live only when
  FestivalOffer.waiveDeliveryFees is on, inside the offer's window, AND the Black Friday
  event is active in the festival theme — `festivalThemeService.isBlackFridayActive()`,
  which never throws (false on a failed read).

  Looked up on the module namespace on purpose: until that branch is merged the
  function does not exist here, and the gate then FAILS CLOSED (offer never live). So
  merging this first can never switch the offer on by accident.
*/
const themeGate = async (now) => {
  const fn = festivalThemeService.isBlackFridayActive;
  return typeof fn === 'function' ? Boolean(await fn(now)) : false;
};
let blackFridayGate = themeGate;

/** Test seam: replace the theme gate (pass null to restore the real one). */
export function setBlackFridayGateForTests(fn) {
  blackFridayGate = fn || themeGate;
}

/** Fee offer live for PRICING: the offer switch (uncached) AND the Black Friday event. */
export async function isFeeOfferLiveForPricing(now = new Date(), session = null) {
  if (!(await isDeliveryFeeOfferLiveForPricing(now, session))) return false;
  return blackFridayGate(now);
}

/** A rate card's distance bands are ascending and end with one open-ended band. */
export function isValidBands(bands) {
  if (!Array.isArray(bands) || bands.length < 1 || bands.length > 10) return false;
  for (let i = 0; i < bands.length; i += 1) {
    const b = bands[i];
    const last = i === bands.length - 1;
    if (!(typeof b?.ratePerKg === 'number' && b.ratePerKg >= 0 && b.ratePerKg <= 1000)) return false;
    if (b.slabRate != null && !(typeof b.slabRate === 'number' && b.slabRate >= 0 && b.slabRate <= 10000)) return false;
    if (last ? b.upToKm != null : !(typeof b.upToKm === 'number' && b.upToKm > 0 && b.upToKm <= 5000)) return false;
    if (!last && i > 0 && !(b.upToKm > bands[i - 1].upToKm)) return false;
  }
  return true;
}

/** Stored doc (possibly partial or null) → full card, defaults filling every gap. */
export function toRateCard(doc) {
  const d = DEFAULT_RATE_CARD;
  const pick = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  const group = (key) => Object.fromEntries(Object.keys(d[key]).map((k) => [k, pick(doc?.[key]?.[k], d[key][k])]));
  return {
    chargeAtCheckout: Boolean(doc?.chargeAtCheckout ?? d.chargeAtCheckout),
    volumetricDivisor: pick(doc?.volumetricDivisor, d.volumetricDivisor),
    courier: group('courier'),
    freight: group('freight'),
    origin: {
      label: typeof doc?.origin?.label === 'string' && doc.origin.label ? doc.origin.label : d.origin.label,
      pin: isValidPin(doc?.origin?.pin) ? doc.origin.pin : d.origin.pin,
      lat: pick(doc?.origin?.lat, d.origin.lat),
      lng: pick(doc?.origin?.lng, d.origin.lng),
    },
    // A malformed stored list falls back to the defaults rather than mispricing.
    distanceBands: (isValidBands(doc?.distanceBands) ? doc.distanceBands : d.distanceBands)
      .map((b) => ({ upToKm: b.upToKm ?? null, ratePerKg: b.ratePerKg, slabRate: b.slabRate ?? null })),
    packing: group('packing'),
    remoteAreaFee: pick(doc?.remoteAreaFee, d.remoteAreaFee),
    insurancePercent: pick(doc?.insurancePercent, d.insurancePercent),
    paymentFeePercent: pick(doc?.paymentFeePercent, d.paymentFeePercent),
    paymentFeeGstPercent: pick(doc?.paymentFeeGstPercent, d.paymentFeeGstPercent),
    paymentFeeMax: pick(doc?.paymentFeeMax, d.paymentFeeMax),
    xlBox: group('xlBox'),
    gstOnFees: {
      enabled: Boolean(doc?.gstOnFees?.enabled ?? d.gstOnFees.enabled),
      percent: pick(doc?.gstOnFees?.percent, d.gstOnFees.percent),
    },
  };
}

export async function getRateCard(session = null) {
  return toRateCard(await deliveryFeeRepository.findConfig(session));
}

/** Normalise a typed PIN ("  560 001 " → "560001"); null when it is not a PIN. */
export function normalizePin(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).replace(/\s+/g, '');
  return isValidPin(s) ? s : null;
}

// Category id → { slug, parent }, for the category size-class guess. Categories change
// rarely and the guess is only an estimate, so a 5-minute in-process copy is plenty and
// keeps ~250 rows off every quote. A failed load degrades to "no category signal".
const CATEGORY_INDEX_TTL_MS = 5 * 60 * 1000;
let categoryIndexCache = { at: 0, index: null };
async function getCategoryIndex(now = Date.now()) {
  if (categoryIndexCache.index && now - categoryIndexCache.at < CATEGORY_INDEX_TTL_MS) return categoryIndexCache.index;
  try {
    const rows = await deliveryFeeRepository.findCategoryRefs();
    const index = new Map(rows.map((c) => [String(c._id), { slug: c.slug, parent: c.parent ? String(c.parent) : null }]));
    categoryIndexCache = { at: now, index };
    return index;
  } catch (err) {
    console.warn(`[deliveryFees] category index load failed: ${err.message}`);
    return categoryIndexCache.index || new Map();
  }
}
/** Test seam: forget the cached category index. */
export function resetCategoryIndexForTests() { categoryIndexCache = { at: 0, index: null }; }

/**
 * The fee block for one quote, or null while fees are switched off (today's
 * "paid on delivery" behaviour — nothing is charged, nothing shown).
 *
 * Without a valid PIN there are no fees yet (`needsPin: true`, no lines, total 0): the
 * shipping rate depends on the distance and the remote-area list, so a number shown
 * before the PIN would be a guess. Order creation refuses a fee block without a PIN.
 *
 * @param {object} args
 * @param {Array}  args.orderItems   priced lines from pricingService.priceItems
 *                                   (each carries `quantity` and `shipping`)
 * @param {number} args.goodsPaise   goods amount the customer pays (after discounts)
 * @param {string} [args.pin]        delivery PIN
 * @param {boolean} [args.applyOffer] the customer tapped "Apply Black Friday offer"
 * @param {Date}   [args.now]
 * @param {object} [args.session]
 */
export async function quoteDeliveryFees({ orderItems, goodsPaise, pin = null, applyOffer = false, now = new Date(), session = null }) {
  const card = await getRateCard(session);
  if (!card.chargeAtCheckout) return null;

  const cleanPin = normalizePin(pin);
  const requested = Boolean(applyOffer);
  const offerLive = await isFeeOfferLiveForPricing(now, session);
  const offerBlock = (savingPaise) => ({
    code: DELIVERY_FEE_OFFER_CODE,
    available: offerLive,
    requested,
    applied: requested && offerLive,
    savingPaise,
    saving: fromPaise(savingPaise),
    error: requested && !offerLive ? OFFER_ERROR.ENDED : null,
  });

  if (!cleanPin) {
    return {
      needsPin: true, pin: null, place: null, distanceKm: null, origin: card.origin.label,
      remote: null, mode: null, chargedKg: null, estimated: false, band: null,
      gstOnFees: card.gstOnFees.enabled ? card.gstOnFees.percent : 0,
      lines: [], totalPaise: 0, total: 0, offer: offerBlock(0),
    };
  }

  const [{ boxes }, isRemote, location, categoryIndex] = await Promise.all([
    getClassBoxes(),
    deliveryFeeRepository.isRemotePin(cleanPin, session),
    deliveryFeeRepository.findPinLocation(cleanPin, session),
    getCategoryIndex(),
  ]);
  const distanceKm = location ? haversineKm(card.origin, location) : null;

  const fees = computeDeliveryFees({
    lines: orderItems.map((i) => ({
      quantity: i.quantity,
      // categoryClass is only the fallback: resolveBox prefers a real size or stored class.
      product: { ...(i.shipping || {}), categoryClass: classFromCategorySlugs(slugsWithAncestors(i.categories, categoryIndex)) },
    })),
    goodsPaise: Math.max(0, Math.round(goodsPaise)),
    isRemote,
    distanceKm,
    card,
    classBoxes: boxes,
  });

  const applied = requested && offerLive;
  return {
    needsPin: false,
    pin: cleanPin,
    // Shown as "Hyderabad, Telangana · ~1,260 km from Delhi". null = PIN not in the
    // location table: priced at the highest band, nothing invented for display.
    place: location ? { district: location.district || null, state: location.state || null } : null,
    distanceKm,
    origin: card.origin.label,
    remote: isRemote,
    mode: fees.mode,
    chargedKg: fees.chargedKg,
    estimated: fees.estimated,
    band: fees.band,
    gstOnFees: card.gstOnFees.enabled ? card.gstOnFees.percent : 0,
    lines: fees.lines.map((l) => ({ ...l, amount: fromPaise(l.amountPaise) })),
    totalPaise: fees.totalPaise,
    total: fromPaise(fees.totalPaise),
    offer: offerBlock(applied ? fees.totalPaise : 0),
  };
}

/** What the order stores: an immutable snapshot of the fee block. */
export function toOrderSnapshot(block, chargedPaise) {
  if (!block) return undefined;
  return {
    pin: block.pin,
    remote: block.remote === true,
    distanceKm: block.distanceKm ?? null,
    place: block.place || undefined,
    band: block.band || undefined,
    mode: block.mode,
    chargedKg: block.chargedKg,
    estimated: block.estimated,
    gstOnFeesPercent: block.gstOnFees,
    lines: block.lines.map(({ code, label, amount }) => ({ code, label, amount })),
    total: block.total,
    charged: fromPaise(chargedPaise),
    offer: {
      code: block.offer.code,
      applied: block.offer.applied,
      saving: block.offer.saving,
    },
  };
}

// ── Display read (cached) ─────────────────────────────────────────────────────

export async function resolvePublicDeliveryFeeConfig(now = new Date()) {
  const { cfg } = await cacheService.wrap(
    CACHE_KEY,
    async () => {
      const [card, offer] = await Promise.all([deliveryFeeRepository.findConfig(), festivalOfferRepository.find()]);
      return {
        cfg: {
          chargeAtCheckout: Boolean(card?.chargeAtCheckout),
          offer: {
            code: DELIVERY_FEE_OFFER_CODE,
            // `live` is as of the cache fill; the window lets the client switch it off
            // at endsAt itself. Display only — the quote decides what is charged.
            // Only meaningful while fees are charged: with fees off there is nothing to waive.
            live: Boolean(card?.chargeAtCheckout) && isDeliveryFeeOfferLive(offer, now) && (await blackFridayGate(now)),
            endsAt: offer?.endsAt ? new Date(offer.endsAt).toISOString() : null,
          },
        },
      };
    },
    { ttl: CACHE_TTL_SECONDS, tags: [DELIVERY_FEE_CACHE_TAG] },
  );
  return cfg;
}

// ── Admin ─────────────────────────────────────────────────────────────────────

const NUMERIC_FIELDS = Object.freeze([
  ['volumetricDivisor', 1000, 10000],
  ['courier.maxKg', 0, 100], ['courier.slabKg', 0.1, 10], ['courier.slabRate', 0, 10000],
  ['freight.minimum', 0, 50000], ['freight.docket', 0, 10000],
  ['freight.otherCharges', 0, 10000], ['freight.fuel', 0, 10000], ['freight.hamaliPerKg', 0, 100],
  ['packing.small', 0, 50000], ['packing.medium', 0, 50000], ['packing.large', 0, 50000], ['packing.xl', 0, 50000],
  ['remoteAreaFee', 0, 50000],
  ['insurancePercent', 0, 100], ['paymentFeePercent', 0, 100], ['paymentFeeGstPercent', 0, 100],
  ['paymentFeeMax', 0, 100000],
  ['xlBox.weightKg', 0.1, 2000], ['xlBox.lengthCm', 1, 1000], ['xlBox.breadthCm', 1, 1000], ['xlBox.heightCm', 1, 1000],
  ['gstOnFees.percent', 0, 100],
  ['origin.lat', 6, 38], ['origin.lng', 68, 98],
]);
export const RATE_CARD_FIELDS = NUMERIC_FIELDS.map(([k]) => k);

/** A typed number: a number, or a numeric string with up to 4 decimals; else NaN. */
function toNumber(v) {
  if (typeof v === 'number') return v;
  return typeof v === 'string' && /^\s*\d+(\.\d{1,4})?\s*$/.test(v) ? Number(v) : NaN;
}

const getPath = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);

/**
 * Parse an admin save. Every number must be present and inside its range — a
 * blank field is an error, never silently 0 (a ₹0 rate would under-quote every order;
 * an absurd one would overcharge). Booleans default to their current value.
 */
export function parseRateCardInput(raw, current) {
  const set = {};
  for (const [path, min, max] of NUMERIC_FIELDS) {
    const v = getPath(raw, path);
    const n = toNumber(v);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw fail(`${path} must be a number from ${min} to ${max}`);
    }
    set[path] = n;
  }
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  set.chargeAtCheckout = bool(raw?.chargeAtCheckout, current.chargeAtCheckout);
  set['gstOnFees.enabled'] = bool(raw?.gstOnFees?.enabled, current.gstOnFees.enabled);
  if (set['courier.slabKg'] > set['courier.maxKg'] && set['courier.maxKg'] > 0) {
    throw fail('courier.slabKg cannot be larger than courier.maxKg');
  }

  const label = typeof raw?.origin?.label === 'string' ? raw.origin.label.trim() : '';
  if (!label || label.length > 60) throw fail('origin.label must be 1 to 60 characters');
  set['origin.label'] = label;
  const originPin = normalizePin(raw?.origin?.pin);
  if (!originPin) throw fail('origin.pin must be a 6-digit PIN code');
  set['origin.pin'] = originPin;

  const bands = Array.isArray(raw?.distanceBands)
    ? raw.distanceBands.map((b, i, all) => ({
      upToKm: i === all.length - 1 ? null : toNumber(b?.upToKm),
      ratePerKg: toNumber(b?.ratePerKg),
      // Blank = "same as the all-India small-parcel rate".
      slabRate: b?.slabRate == null || b.slabRate === '' ? null : toNumber(b.slabRate),
    }))
    : null;
  if (!isValidBands(bands)) {
    throw fail('Distance bands: up to 10 bands, km going up, each with a ₹/kg from 0 to 1000 and an optional small-parcel ₹ per slab from 0 to 10000; the last band has no km limit');
  }
  set.distanceBands = bands;
  return set;
}

export async function getAdminDeliveryFeeConfig() {
  const [doc, remotePinCount, pinLocationCount] = await Promise.all([
    deliveryFeeRepository.findConfig(),
    deliveryFeeRepository.countRemotePins(),
    deliveryFeeRepository.countPinLocations(),
  ]);
  return { ...toRateCard(doc), updatedAt: doc?.updatedAt ?? null, remotePinCount, pinLocationCount };
}

/**
 * The two on/off switches — "Charge delivery fees at checkout" and "Add GST on
 * delivery fees" — are business/tax decisions, not courier rates, so only an admin
 * may change them. Procurement (who know the courier bills) save rates with
 * `allowSwitches: false`: a payload that even names a switch is refused, never
 * silently half-applied, and the stored switch values are kept.
 */
export async function updateRateCard(req, raw, { allowSwitches = true } = {}) {
  if (!allowSwitches && (raw?.chargeAtCheckout !== undefined || raw?.gstOnFees?.enabled !== undefined)) {
    throw fail('Only an admin can turn delivery fees or GST on fees on or off', 403);
  }
  const before = toRateCard(await deliveryFeeRepository.findConfig());
  const set = parseRateCardInput(raw, before);
  const doc = await deliveryFeeRepository.saveConfig({ ...set, updatedBy: req.user?._id ?? null });
  await invalidatePublic();
  // Changes what every customer is charged: an audited money action.
  await auditLogger.logAction(req, 'DELIVERY_FEE_RATES_UPDATE', 'DeliveryFeeConfig', doc._id, {
    from: before,
    to: toRateCard(doc),
  });
  return getAdminDeliveryFeeConfig();
}

/** Pull every 6-digit PIN out of pasted text (CSV, one per line, commas…). */
export function parsePinList(text) {
  if (typeof text !== 'string') throw fail('Paste the PIN codes as text');
  const found = text.match(/(?<!\d)[1-9]\d{5}(?!\d)/g) || [];
  const pins = [...new Set(found)];
  if (pins.length > MAX_REMOTE_PINS_PER_UPLOAD) throw fail(`At most ${MAX_REMOTE_PINS_PER_UPLOAD} PINs at a time`);
  return pins;
}

export async function addRemotePins(req, { text, note = null }) {
  const pins = parsePinList(text);
  if (!pins.length) throw fail('No 6-digit PIN codes found');
  const cleanNote = note ? String(note).trim().slice(0, 120) || null : null;
  const added = await deliveryFeeRepository.addRemotePins(pins, cleanNote, req.user?._id);
  await auditLogger.logAction(req, 'REMOTE_PINS_ADD', 'RemotePin', null, { received: pins.length, added, note: cleanNote });
  return { received: pins.length, added, alreadyListed: pins.length - added };
}

export async function removeRemotePins(req, { text }) {
  const pins = parsePinList(text);
  if (!pins.length) throw fail('No 6-digit PIN codes found');
  const removed = await deliveryFeeRepository.removeRemotePins(pins);
  await auditLogger.logAction(req, 'REMOTE_PINS_REMOVE', 'RemotePin', null, { received: pins.length, removed });
  return { received: pins.length, removed };
}

export async function listRemotePins({ cursor = null, limit = 100, prefix = null } = {}) {
  const lim = Math.min(Math.max(1, parseInt(limit, 10) || 100), MAX_REMOTE_PIN_PAGE);
  const cleanPrefix = typeof prefix === 'string' && /^\d{1,6}$/.test(prefix) ? prefix : null;
  const afterPin = normalizePin(cursor);
  const rows = await deliveryFeeRepository.listRemotePins({ afterPin, limit: lim + 1, prefix: cleanPrefix });
  const page = rows.slice(0, lim);
  return {
    pins: page.map((r) => ({ pin: r.pin, note: r.note || null, addedAt: r.createdAt || null })),
    nextCursor: rows.length > lim ? page[page.length - 1].pin : null,
  };
}

async function invalidatePublic() {
  invalidateCache(DELIVERY_FEE_CACHE_TAG);
  // The storefront's Black Friday "without delivery charges" seal reads
  // /delivery-fees/public through Next's Data Cache under the festival-offer tag, so
  // turning fees off must drop it now, not after its 60 s revalidate.
  revalidateFrontendTags(festivalOfferTags());
}

export default {
  getRateCard,
  quoteDeliveryFees,
  toOrderSnapshot,
  resolvePublicDeliveryFeeConfig,
  getAdminDeliveryFeeConfig,
  updateRateCard,
  addRemotePins,
  removeRemotePins,
  listRemotePins,
};
