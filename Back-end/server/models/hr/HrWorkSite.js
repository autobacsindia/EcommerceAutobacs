import mongoose from 'mongoose';
import { SITE_RADIUS_MIN_M, SITE_RADIUS_MAX_M } from '../../config/hr.js';

/**
 * A place employees may clock in: an office, warehouse or store, with a radius.
 * The SERVER decides inside/outside from the submitted GPS (haversine against the
 * employee's allowed sites — a handful, so no geo index is needed). Sites are
 * deactivated, never deleted, because punches reference them.
 */
const HrWorkSiteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  address: { type: String, default: '', maxlength: 400 },
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
  radiusM: { type: Number, required: true, min: SITE_RADIUS_MIN_M, max: SITE_RADIUS_MAX_M },
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rev: { type: Number, default: 0 },
}, { timestamps: true });

HrWorkSiteSchema.index({ active: 1, name: 1 }, { name: 'hr_site_active_name' });

export default mongoose.models.HrWorkSite || mongoose.model('HrWorkSite', HrWorkSiteSchema);
