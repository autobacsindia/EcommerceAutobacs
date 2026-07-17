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
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  image: {
    url: String,
    alt: String,
    // Present when the image was uploaded to Cloudinary (vs a legacy pasted
    // URL). Lets us delete/replace the old asset on update.
    public_id: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index for vehicle queries
VehicleSchema.index({ make: 1, model: 1 });

export default mongoose.model("Vehicle", VehicleSchema);