import mongoose from 'mongoose';
import deliveryZoneService from './deliveryZoneService.js';
import deliveryZoneRepository from '../repositories/deliveryZoneRepository.js';
import productRepository from '../repositories/productRepository.js';
import { mayUseEnquiries } from './supplierEnquiryService.js';
import AppError from '../utils/AppError.js';

/**
 * Delivery charge ESTIMATE for the procurement panel's shipping calculator:
 * pincode + weight → the delivery zone's rate (base + per kg).
 *
 * Reuses the one shipping-rate system there is (DeliveryZone +
 * deliveryZoneService.calculateShippingCost) — no second rate table. Read-only:
 * nothing here touches an order, a cart or a checkout total.
 *
 * Money leaves as whole paise; the zone's rupee figures are rounded once here.
 */

const PIN = /^[1-9]\d{5}$/;
const MAX_WEIGHT_KG = 1000;
const MAX_ITEMS = 50;

const fail = (message, status) => new AppError(message, status, { expose: true });
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const isId = (v) => mongoose.isValidObjectId(v) && String(new mongoose.Types.ObjectId(String(v))) === String(v);

/** Weight typed in, as kg with up to 3 decimals; '' / missing → null. */
function typedWeight(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw fail('Weight should be in kg, e.g. 2 or 2.5.', 400);
  const kg = Number(s);
  if (kg > MAX_WEIGHT_KG) throw fail(`Weight can be at most ${MAX_WEIGHT_KG} kg.`, 400);
  return kg;
}

/** Products picked to add up their weight: [{ productId, qty }]. */
async function productWeights(rawItems) {
  const list = (Array.isArray(rawItems) ? rawItems : []).slice(0, MAX_ITEMS + 1);
  if (list.length > MAX_ITEMS) throw fail(`Pick at most ${MAX_ITEMS} products.`, 400);
  const items = list.map((it) => {
    const qty = Number(it?.qty);
    if (!isId(it?.productId)) throw fail('One of the products is not valid.', 400);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) throw fail('Quantity should be a whole number from 1.', 400);
    return { productId: String(it.productId), qty };
  });
  if (!items.length) return { items: [], kg: 0 };
  const docs = await productRepository.findShippingWeights([...new Set(items.map((i) => i.productId))]);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  let grams = 0;
  const out = items.map(({ productId, qty }) => {
    const d = byId.get(productId);
    if (!d) throw fail('One of the products was not found.', 404);
    const kg = d.shippingSize?.weightKg ?? null;
    if (kg != null) grams += Math.round(kg * 1000) * qty; // whole grams: no float drift across lines
    return { productId, name: d.name, qty, weightKg: kg };
  });
  return { items: out, kg: grams / 1000 };
}

export async function estimate(actor, input = {}) {
  if (!mayUseEnquiries(actor)) throw fail('Only the procurement team can use this.', 403);
  const pin = String(input.pin ?? '').replace(/\s/g, '');
  if (!PIN.test(pin)) throw fail('Enter a 6-digit pincode, e.g. 682001.', 400);

  const typed = typedWeight(input.weightKg);
  const picked = await productWeights(input.items);
  const weightKg = Math.round(((typed ?? 0) + picked.kg) * 1000) / 1000;
  const missingWeight = picked.items.filter((i) => i.weightKg == null).map((i) => i.name);
  const base = { pin, weightKg, items: picked.items, missingWeight };

  const zone = await deliveryZoneService.getZoneByPinCode(pin);
  if (!zone) {
    const zonesConfigured = await deliveryZoneRepository.countServiceable();
    return { ...base, found: false, zonesConfigured };
  }
  const cost = await deliveryZoneService.calculateShippingCost(pin, weightKg);
  const basePaise = toPaise(cost.breakdown.baseRate);
  const totalPaise = toPaise(cost.shippingCost);
  return {
    ...base,
    found: true,
    zone: { name: zone.name, type: zone.type },
    deliveryDays: { min: zone.deliveryTime?.minDays ?? null, max: zone.deliveryTime?.maxDays ?? null },
    basePaise,
    perKgPaise: toPaise(cost.breakdown.perKgRate),
    weightPaise: totalPaise - basePaise,
    totalPaise,
  };
}

export default { estimate };
