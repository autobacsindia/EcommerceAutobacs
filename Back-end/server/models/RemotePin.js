import mongoose from 'mongoose';

/**
 * RemotePin — PIN codes the courier charges an Out-of-Delivery-Area (ODA) fee
 * for (e.g. Jalpaiguri). A PIN on this list adds the Remote area fee at checkout.
 * Admin-maintained (paste the courier's ODA list). One document per PIN; the
 * unique index is also the lookup index for the one findOne per quote.
 */
const RemotePinSchema = new mongoose.Schema({
  pin: { type: String, required: true, unique: true, match: /^[1-9]\d{5}$/ },
  note: { type: String, default: null, maxlength: 120, trim: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('RemotePin', RemotePinSchema);
