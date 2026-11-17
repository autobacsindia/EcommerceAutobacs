import mongoose from 'mongoose';

/**
 * A printable slip's template — delivery slip, job card, a letter to the RTO —
 * stored here so the admin adds or changes one without a code release
 * (Admin → Slip templates; services/slipTemplateService.js validates every
 * definition). The shape is described in config/projectTemplates.js.
 *
 * Deleting archives (`archivedAt`); a project's saved slip boxes stay, so
 * restoring it brings them back. `active: false` hides it from the menu
 * without deleting it.
 */
const FieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, required: true },
    max: { type: Number, default: undefined },
    upper: { type: Boolean, default: undefined },
    placeholder: { type: String, default: undefined },
    notBefore: { type: String, default: undefined },
  },
  { _id: false },
);

const BlockSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['section', 'paragraph', 'items'], required: true },
    title: { type: String, default: undefined },
    keys: { type: [String], default: undefined },
    text: { type: String, default: undefined },
    bold: { type: Boolean, default: undefined },
    key: { type: String, default: undefined },
  },
  { _id: false },
);

const SlipTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    title: { type: String, required: true },
    forms: { type: [String], default: [] },
    fields: { type: [FieldSchema], default: [] },
    blocks: { type: [BlockSchema], default: [] },
    needs: { type: [String], default: [] },
    declaration: { type: String, default: '' },
    signatures: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    /** One of config/projectTemplates.js DEFAULT_SLIPS — it can be reset to that. */
    isDefault: { type: Boolean, default: false },
    /** The list order in the menu. */
    order: { type: Number, default: 100 },
    rev: { type: Number, default: 1 },
    archivedAt: { type: Date, default: null },
    updatedByName: { type: String, default: '' },
  },
  { timestamps: true, collection: 'sliptemplates' },
);

// Also built at startup by config/db.js ensureCriticalIndexes (autoIndex is off in production).
SlipTemplateSchema.index({ key: 1 }, { unique: true, name: 'slip_template_key' });

export default mongoose.models.SlipTemplate || mongoose.model('SlipTemplate', SlipTemplateSchema);
