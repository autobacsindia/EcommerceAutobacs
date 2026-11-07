import mongoose from 'mongoose';

/**
 * FestivalOffer — singleton switch for the festival (Diwali) tiered PRICE offer.
 *
 * Deliberately separate from FestivalTheme: that one is decoration and promises never
 * to touch money. This one changes what customers are charged, so it has its own
 * switch — the theme can stay on while the discount is switched off, instantly.
 *
 * Only the switch and the window live here. The tier percentages are code
 * (utils/festivalOffer.js) so a mistyped admin field can never misprice the catalogue.
 * Read by services/festivalOfferService.js.
 */
const FestivalOfferSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true, immutable: true },

  enabled: { type: Boolean, default: false },

  // Window (stored UTC; the admin enters IST). Either end may be open.
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

export default mongoose.model('FestivalOffer', FestivalOfferSchema);
