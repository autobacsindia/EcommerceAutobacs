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
    required: true
  },
  source: {
    type: String,
    enum: ['wordpress', 'manual', 'scheduled'],
    default: 'manual'
  }
}, { 
  timestamps: true 
});

// Indexes for better query performance
ImportJobSchema.index({ jobId: 1 });
ImportJobSchema.index({ status: 1 });
ImportJobSchema.index({ initiatedBy: 1 });
ImportJobSchema.index({ createdAt: -1 });

export default mongoose.model("ImportJob", ImportJobSchema);