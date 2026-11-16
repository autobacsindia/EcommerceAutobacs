import mongoose from 'mongoose';
import { DEFAULT_RATE_CARD as D } from '../utils/deliveryFees.js';

/**
 * DeliveryFeeConfig — singleton (key "default") rate card for the itemised
 * delivery fees charged at checkout (utils/deliveryFees.js does the maths).
 *
 * `chargeAtCheckout` is the go-live switch: while it is off nothing is charged and
 * the storefront keeps saying "shipping paid on delivery". Every other field is a
 * rate copied from a real courier bill — see the legal note in utils/deliveryFees.js.
 *
 * Read UNCACHED by pricing (a rate change must price the very next quote), cached
 * only for the storefront's display read. Rupees; per-kg rates may carry paise.
 */
const money = (def, max = 100000) => ({ type: Number, min: 0, max, default: def });
const percent = (def) => ({ type: Number, min: 0, max: 100, default: def });

const DeliveryFeeConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true, immutable: true },

  chargeAtCheckout: { type: Boolean, default: D.chargeAtCheckout },
  volumetricDivisor: { type: Number, min: 1000, max: 10000, default: D.volumetricDivisor },

  courier: {
    maxKg: { type: Number, min: 0, max: 100, default: D.courier.maxKg },
    slabKg: { type: Number, min: 0.1, max: 10, default: D.courier.slabKg },
    slabRate: money(D.courier.slabRate, 10000),
  },
  freight: {
    minimum: money(D.freight.minimum, 50000),
    docket: money(D.freight.docket, 10000),
    otherCharges: money(D.freight.otherCharges, 10000),
    fuel: money(D.freight.fuel, 10000),
    hamaliPerKg: money(D.freight.hamaliPerKg, 100),
  },
  // Dispatch point for the distance (haversine to the delivery PIN's lat/long).
  origin: {
    label: { type: String, default: D.origin.label, maxlength: 60, trim: true },
    pin: { type: String, default: D.origin.pin, match: /^[1-9]\d{5}$/ },
    lat: { type: Number, min: 6, max: 38, default: D.origin.lat },     // India's bounding box
    lng: { type: Number, min: 68, max: 98, default: D.origin.lng },
  },
  // Freight ₹/kg by distance; ascending, the last one open-ended (upToKm null).
  // Validated as a whole in services/deliveryFeeService.js parseRateCardInput.
  distanceBands: {
    type: [new mongoose.Schema({
      upToKm: { type: Number, min: 1, max: 5000, default: null },
      ratePerKg: money(16, 1000),
    }, { _id: false })],
    default: () => D.distanceBands.map((b) => ({ ...b })),
  },
  packing: {
    small: money(D.packing.small, 50000),
    medium: money(D.packing.medium, 50000),
    large: money(D.packing.large, 50000),
    xl: money(D.packing.xl, 50000),
  },
  remoteAreaFee: money(D.remoteAreaFee, 50000),
  insurancePercent: percent(D.insurancePercent),
  paymentFeePercent: percent(D.paymentFeePercent),
  paymentFeeGstPercent: percent(D.paymentFeeGstPercent),
  gstOnFees: {
    enabled: { type: Boolean, default: D.gstOnFees.enabled },
    percent: percent(D.gstOnFees.percent),
  },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('DeliveryFeeConfig', DeliveryFeeConfigSchema);
