import mongoose from 'mongoose';

/**
 * PinLocation — one row per Indian PIN code: its centre (lat/long) and place name,
 * from the free India Post "All India Pincode Directory" (data.gov.in). Used ONLY to
 * work out the distance band for delivery fees and to show "Hyderabad, Telangana ·
 * ~1,260 km from Delhi". Loaded by scripts/import-pin-locations.js (dry-run by default).
 * A PIN missing here is not an error: it prices at the highest distance band.
 */
const PinLocationSchema = new mongoose.Schema({
  pin: { type: String, required: true, unique: true, match: /^[1-9]\d{5}$/ },
  lat: { type: Number, required: true, min: 6, max: 38 },
  lng: { type: Number, required: true, min: 68, max: 98 },
  district: { type: String, default: null, maxlength: 80 },
  state: { type: String, default: null, maxlength: 60 },
}, { timestamps: false, versionKey: false });

export default mongoose.model('PinLocation', PinLocationSchema);
