import MetaLead from '../models/MetaLead.js';
import MetaLeadSyncState from '../models/MetaLeadSyncState.js';

const STATE_ID = 'sheet';
const LIST_FIELDS = {
  tab: 1, rowNumber: 1, leadDate: 1, dateRaw: 1, dateHasTime: 1, sortAt: 1, name: 1, phone: 1, email: 1,
  product: 1, campaign: 1, salesPerson: 1, status: 1, followUp1: 1, followUp2: 1, revision: 1,
  phoneKey: 1, removedFromSheetAt: 1, followingUpBy: 1, followingUpName: 1, followingUpAt: 1, followUpStatus: 1, followUpStatusAt: 1,
};
const DETAIL_FIELDS = { ...LIST_FIELDS, fields: 1, editedFields: 1, edits: { $slice: -50 }, followUpLog: { $slice: -50 } };
// What the sync compares. Never the follow-up fields: it has no business reading them.
const SYNC_FIELDS = {
  sheetKey: 1, metaLeadId: 1, tab: 1, rowNumber: 1, leadDate: 1, dateRaw: 1, dateHasTime: 1, name: 1, phone: 1, phoneKey: 1, email: 1,
  product: 1, campaign: 1, salesPerson: 1, status: 1, followUp1: 1, followUp2: 1, fields: 1, editedFields: 1, revision: 1, removedFromSheetAt: 1,
};
const LOG_MAX = 200;
const RELATED_LIMIT = 200;
const logEntry = (entry) => ({ followUpLog: { $each: [entry], $slice: -LOG_MAX } });
const after = { new: true, projection: DETAIL_FIELDS };

/** Data access for the Meta leads tab and its sheet sync. */
const metaLeadRepository = {
  page: (query, { sort, limit }) => MetaLead.find(query, LIST_FIELDS).sort(sort).limit(limit).lean(),

  findDetail: (id) => MetaLead.findById(id, DETAIL_FIELDS).lean(),

  /** Every saved row, by key: the sync needs all of them to notice one that left the sheet. */
  async findAllForSync() {
    const found = new Map();
    for await (const row of MetaLead.find({}, SYNC_FIELDS).lean().cursor()) found.set(row.sheetKey, row);
    return found;
  },

  /** Rows per tab, including tabs no longer in the sheet, so the filter can still reach them. */
  tabCounts: () => MetaLead.aggregate([{ $group: { _id: '$tab', rows: { $sum: 1 } } }, { $project: { _id: 0, name: '$_id', rows: 1 } }, { $sort: { name: 1 } }]),

  /** Other enquiries from these phones, for the "also enquired" note. */
  findByPhoneKeys: (keys) => MetaLead.find({ phoneKey: { $in: keys } }, { phoneKey: 1, tab: 1, product: 1, followingUpName: 1 }).limit(RELATED_LIMIT).lean(),

  /** Everyone holding a lead right now, for the "by person" filter. */
  holders: () => MetaLead.aggregate([
    { $match: { followingUpBy: { $ne: null } } },
    { $group: { _id: '$followingUpBy', name: { $last: '$followingUpName' } } },
    { $sort: { name: 1 } },
  ]),

  /** Take a free lead. Null = someone else got there first. */
  claim: (id, { userId, name, at, entry }) => MetaLead.findOneAndUpdate(
    { _id: id, followingUpBy: null },
    { $set: { followingUpBy: userId, followingUpName: name, followingUpAt: at }, $push: logEntry(entry) },
    after,
  ).lean(),

  /** Free or move a lead, only if it is still with `fromUserId`. Null = it moved meanwhile. */
  moveOwner: (id, fromUserId, to, entry) => MetaLead.findOneAndUpdate(
    { _id: id, followingUpBy: fromUserId },
    { $set: { followingUpBy: to?.userId ?? null, followingUpName: to?.name ?? '', followingUpAt: to?.at ?? null }, $push: logEntry(entry) },
    after,
  ).lean(),

  /** Save a follow-up, only if owner and last follow-up are what the caller saw. Null = they changed. */
  recordFollowUp: (id, { ownerId, seenAt, status, at, entry }) => MetaLead.findOneAndUpdate(
    { _id: id, followingUpBy: ownerId, followUpStatusAt: seenAt ?? null },
    { $set: { followUpStatus: status, followUpStatusAt: at }, $push: logEntry(entry) },
    after,
  ).lean(),

  bulkWrite: (ops) => (ops.length ? MetaLead.bulkWrite(ops, { ordered: false }) : null),

  /** Apply a person's edit only if nobody else saved first. Null = they did. */
  applyEdit: (id, revision, update, arrayFilters) =>
    MetaLead.findOneAndUpdate({ _id: id, revision }, update, { ...after, arrayFilters }).lean(),

  getState: () => MetaLeadSyncState.findById(STATE_ID).lean(),

  saveState: (patch) => MetaLeadSyncState.updateOne({ _id: STATE_ID }, { $set: patch }, { upsert: true }),
};

export default metaLeadRepository;
