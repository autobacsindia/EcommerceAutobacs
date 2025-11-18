import mongoose from "mongoose";

const VehicleSchema = new mongoose.Schema({
  make: { 
    type: String, 
    required: true,
    trim: true
  },
  model: { 
    type: String, 
    required: true,
    trim: true
  },
  year: {
    type: Number,
    required: true
  },
  variant: {
    type: String,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  image: {
    url: String,
    alt: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true 
});

// Compound index for vehicle queries
VehicleSchema.index({ make: 1, model: 1, year: 1 });
VehicleSchema.index({ slug: 1 });

export default mongoose.model("Vehicle", VehicleSchema);
