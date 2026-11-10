import mongoose from 'mongoose';

/**
 * The outcome of the latest sheet sync: one document, _id 'sheet'. The Meta leads
 * tab reads it for "Last updated", the Tab filter and the warning when the feed
 * has stopped — a silent stop would look exactly like "no new leads today".
 */
const MetaLeadSyncStateSchema = new mongoose.Schema(
  {
    _id: { type: String },
    lastAttemptAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    tabs: { type: [{ _id: false, name: String, rows: Number }], default: [] },
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Each tab's column names, to notice a column being inserted or moved.
    layouts: { type: [{ _id: false, tab: String, columns: [String], changedAt: Date }], default: [] },
    // Tabs whose columns could not be understood, so their rows were not read.
    skippedTabs: { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model('MetaLeadSyncState', MetaLeadSyncStateSchema);
