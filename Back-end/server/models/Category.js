import mongoose from "mongoose";

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
    url: String,
    alt: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  }
}, { 
  timestamps: true 
});

// Index for hierarchical queries
CategorySchema.index({ parent: 1 });
CategorySchema.index({ slug: 1 });

export default mongoose.model("Category", CategorySchema);
