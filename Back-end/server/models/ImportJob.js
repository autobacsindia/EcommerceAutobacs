import mongoose from "mongoose";

const ImportJobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  totalProducts: {
    type: Number,
    default: 0
  },
  processedProducts: {
    type: Number,
    default: 0
  },
  importedProducts: {
    type: Number,
    default: 0
  },
  failedProducts: {
    type: Number,
    default: 0
  },
  skippedProducts: {
    type: Number,
    default: 0
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  failedAt: {
    type: Date
  },
  errorMessage: {
    type: String
  },
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Made optional to support system-initiated jobs
  },
  source: {
    type: String,
    enum: ['wordpress', 'wordpress-categories', 'wordpress-products', 'manual', 'scheduled', 'scheduled-failed'],
    default: 'manual'
  },
  // New field to track if this is a re-import of failed products
  isReimport: {
    type: Boolean,
    default: false
  },
  // Reference to the original job if this is a re-import
  originalJobId: {
    type: String,
    required: false
  }
}, { 
  timestamps: true 
});

// Indexes for better query performance
ImportJobSchema.index({ status: 1 });
ImportJobSchema.index({ initiatedBy: 1 });
ImportJobSchema.index({ createdAt: -1 });
ImportJobSchema.index({ source: 1 });
ImportJobSchema.index({ isReimport: 1 });

export default mongoose.model("ImportJob", ImportJobSchema);