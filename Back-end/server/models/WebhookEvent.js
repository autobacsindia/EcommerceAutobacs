import mongoose from 'mongoose';

const WebhookEventSchema = new mongoose.Schema({
  eventId:     { type: String, required: true, unique: true },
  eventType:   { type: String, required: true },
  processedAt: { type: Date, default: Date.now }
});

// Mirror Redis TTL: auto-purge records after 24 hours.
WebhookEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 86400 });

export default mongoose.model('WebhookEvent', WebhookEventSchema);
