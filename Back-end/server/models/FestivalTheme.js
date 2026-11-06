import mongoose from 'mongoose';
import { FESTIVAL_THEME_KEYS, DEFAULT_FESTIVAL_THEME_KEY } from '../config/festivalThemes.js';

/**
 * FestivalTheme — singleton switch for the storefront's festive decoration
 * (Diwali sparks, toran, fireworks on order success, deal badges, countdown).
 *
 * One document (key: "default"). Purely presentational: nothing here touches
 * price, stock or order state. Read through services/festivalThemeService.js,
 * which applies the date window and caches the public shape.
 */
const FestivalThemeSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true, immutable: true },

  enabled: { type: Boolean, default: false },
  themeKey: { type: String, enum: FESTIVAL_THEME_KEYS, default: DEFAULT_FESTIVAL_THEME_KEY },

  // Window (stored UTC; the admin enters IST). Either end may be open.
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

/** Fetch (or lazily create) the singleton. Upsert guards the create race. */
FestivalThemeSchema.statics.getSingleton = async function () {
  const doc = await this.findOne({ key: 'default' }).lean();
  if (doc) return doc;
  return this.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default' } },
    { upsert: true, new: true, setDefaultsOnInsert: true, lean: true },
  );
};

export default mongoose.model('FestivalTheme', FestivalThemeSchema);
