import mongoose from "mongoose";
import SeoSchema from "./shared/seoSchema.js";

const CategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  description: {
    type: String
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    default: null
  },
  image: {
    url:       String,  // Cloudinary secure_url
    public_id: String,  // Cloudinary public_id (for deletion/replacement)
    alt:       String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  // Editorially promoted hub. Featured categories lead the homepage categories
  // carousel and render a distinct badge. Independent of `order` (which still
  // sequences peers). Applies to top-level hubs — the carousel only shows hubs.
  isFeatured: {
    type: Boolean,
    default: false
  },

  // SEO metadata overrides (optional; blank fields fall back to name/description
  // on the frontend). See models/shared/seoSchema.js.
  seo: { type: SeoSchema, default: () => ({}) },


  // WordPress/WooCommerce sync fields
  wpId: {
    type: Number,
    unique: true,
    sparse: true, // Allow null for non-WP categories
    index: true
  },
  syncedFromWordPress: {
    type: Boolean,
    default: false,
    index: true
  },
  lastSyncedAt: Date
}, { 
  timestamps: true 
});

// Index for hierarchical queries
CategorySchema.index({ parent: 1 });

export default mongoose.model("Category", CategorySchema);
