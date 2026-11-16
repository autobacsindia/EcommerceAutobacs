import mongoose from 'mongoose';
import { SHIPPING_SIZE_LIMITS as SZ } from '../utils/shippingSize.js';
import { DEFAULT_CLASS_BOXES } from '../utils/shippingClass.js';

/**
 * ShippingClassConfig — singleton (key "default") holding the standard box for
 * each size class: what a fee estimate assumes for a product that has a class
 * but no measured box. XL has no box on purpose (freight, quoted by hand).
 *
 * Admin-editable; read through services/shippingClassService.js. Nothing here
 * is charged today — it feeds a later shipping-fee estimate.
 */
const box = (d) => new mongoose.Schema({
  weightKg:  { type: Number, required: true, min: SZ.weightKg.min,  max: SZ.weightKg.max,  default: d.weightKg },
  lengthCm:  { type: Number, required: true, min: SZ.lengthCm.min,  max: SZ.lengthCm.max,  default: d.lengthCm },
  breadthCm: { type: Number, required: true, min: SZ.breadthCm.min, max: SZ.breadthCm.max, default: d.breadthCm },
  heightCm:  { type: Number, required: true, min: SZ.heightCm.min,  max: SZ.heightCm.max,  default: d.heightCm },
}, { _id: false });

const ShippingClassConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true, immutable: true },
  boxes: {
    small:  { type: box(DEFAULT_CLASS_BOXES.small),  default: () => ({ ...DEFAULT_CLASS_BOXES.small }) },
    medium: { type: box(DEFAULT_CLASS_BOXES.medium), default: () => ({ ...DEFAULT_CLASS_BOXES.medium }) },
    large:  { type: box(DEFAULT_CLASS_BOXES.large),  default: () => ({ ...DEFAULT_CLASS_BOXES.large }) },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('ShippingClassConfig', ShippingClassConfigSchema);
