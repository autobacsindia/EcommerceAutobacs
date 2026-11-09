import MetaLead from '../models/MetaLead.js';
import MetaLeadSyncState from '../models/MetaLeadSyncState.js';

const STATE_ID = 'sheet';
const LIST_FIELDS = {
  tab: 1, rowNumber: 1, leadDate: 1, dateRaw: 1, dateHasTime: 1, sortAt: 1, name: 1, phone: 1, email: 1,
  product: 1, campaign: 1, salesPerson: 1, status: 1, followUp1: 1, followUp2: 1, revision: 1,
};
const LOOKUP_BATCH = 500;

/** Data access for the Meta leads tab and its sheet sync. */
const metaLeadRepository = {
  page: (query, { sort, limit }) => MetaLead.find(query, LIST_FIELDS).sort(sort).limit(limit).lean(),

  findDetail: (id) => MetaLead.findById(id, { ...LIST_FIELDS, fields: 1, editedFields: 1, edits: { $slice: -50 } }).lean(),

  /** Existing rows for these keys: looked up in batches, so a huge sheet is one bounded read at a time. */
  async findBySheetKeys(keys) {
    const found = new Map();
    for (let i = 0; i < keys.length; i += LOOKUP_BATCH) {
      const rows = await MetaLead.find({ sheetKey: { $in: keys.slice(i, i + LOOKUP_BATCH) } }).lean();
      rows.forEach((r) => found.set(r.sheetKey, r));
    }
    return found;
  },

  bulkWrite: (ops) => (ops.length ? MetaLead.bulkWrite(ops, { ordered: false }) : null),

  /** Apply a person's edit only if nobody else saved first. Null = they did. */
  applyEdit: (id, revision, update, arrayFilters) =>
    MetaLead.findOneAndUpdate({ _id: id, revision }, update, { new: true, arrayFilters, projection: { ...LIST_FIELDS, fields: 1, editedFields: 1, edits: { $slice: -50 } } }).lean(),

  getState: () => MetaLeadSyncState.findById(STATE_ID).lean(),

  saveState: (patch) => MetaLeadSyncState.updateOne({ _id: STATE_ID }, { $set: patch }, { upsert: true }),
};

export default metaLeadRepository;
