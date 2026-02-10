import mongoose from "mongoose";

const BrandSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true 
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  externalId: {
    type: String,
    sparse: true,
    index: true
  },
  logo: {
    type: String
  },
  description: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true 
});

// Indexes for better query performance
BrandSchema.index({ name: 1 });
// BrandSchema.index({ externalId: 1 }); // Defined in schema

// Transform the output to always use ObjectId as id
BrandSchema.set('toJSON', {
  transform: function (doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
  }
});

export default mongoose.model("Brand", BrandSchema);