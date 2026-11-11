import MetaLead from '../models/MetaLead.js';
import MetaLeadSyncState from '../models/MetaLeadSyncState.js';

const STATE_ID = 'sheet';
const LIST_FIELDS = {
  tab: 1, rowNumber: 1, leadDate: 1, dateRaw: 1, dateHasTime: 1, sortAt: 1, name: 1, phone: 1, email: 1,
  product: 1, campaign: 1, salesPerson: 1, status: 1, followUp1: 1, followUp2: 1, revision: 1,
  phoneKey: 1, removedFromSheetAt: 1, followingUpBy: 1, followingUpName: 1, followingUpAt: 1, followUpStatus: 1, followUpStatusAt: 1,
};
Object.assign(LIST_FIELDS, {
  nextFollowUpAt: 1, lateReason: 1, lateReasonFor: 1, reschedules: 1, explanation: 1, sheetDirty: 1, sheetWriteError: 1,
});
const DETAIL_FIELDS = { ...LIST_FIELDS, fields: 1, editedFields: 1, edits: { $slice: -50 }, followUpLog: { $slice: -50 } };
// What the sync compares. Never the follow-up fields: it has no business reading them.
const SYNC_FIELDS = {
  sheetKey: 1, metaLeadId: 1, tab: 1, rowNumber: 1, leadDate: 1, dateRaw: 1, dateHasTime: 1, name: 1, phone: 1, phoneKey: 1, email: 1,
  product: 1, campaign: 1, salesPerson: 1, status: 1, followUp1: 1, followUp2: 1, fields: 1, editedFields: 1, revision: 1, removedFromSheetAt: 1,
};
const LOG_MAX = 200;
const RELATED_LIMIT = 200;
const logEntry = (entry) => ({ followUpLog: { $each: [entry], $slice: -LOG_MAX } });
const logEntries = (entries) => ({ followUpLog: { $each: entries, $slice: -LOG_MAX } });
// Every panel change: the sheet must hear about it (services/metaLeadSheetWriter.js).
const toSheet = (at) => ({ sheetDirty: true, sheetChangedAt: at });
const bumpSheet = { sheetWanted: 1 };
const NO_MESSAGES = { reminderSentFor: null, escalatedHeadFor: null, escalatedManagersFor: null };
// What the sheet writer needs: identity, the team's edited cells, and the panel's own columns.
const WRITE_FIELDS = {
  sheetKey: 1, metaLeadId: 1, tab: 1, rowNumber: 1, leadDate: 1, dateRaw: 1, name: 1, phone: 1, email: 1, product: 1, campaign: 1,
  salesPerson: 1, status: 1, followUp1: 1, followUp2: 1, fields: 1, editedFields: 1, removedFromSheetAt: 1,
  followingUpName: 1, followUpStatus: 1, followUpLog: { $slice: -20 }, nextFollowUpAt: 1, lateReason: 1,
  sheetWanted: 1, sheetChangedAt: 1,
};
const SHEET_WRITE_BATCH = 300;
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
  claim: (id, { userId, name, at, entry, nextAt = null }) => MetaLead.findOneAndUpdate(
    { _id: id, followingUpBy: null },
    {
      $set: { followingUpBy: userId, followingUpName: name, followingUpAt: at, nextFollowUpAt: nextAt, ...NO_MESSAGES, ...toSheet(at) },
      $inc: bumpSheet,
      $push: logEntry(entry),
    },
    after,
  ).lean(),

  /** Free or move a lead, only if it is still with `fromUserId`. Null = it moved meanwhile. */
  /*
    Freed: nobody owes a follow-up, so the deadline goes. Moved: the deadline
    stays (the customer is still waiting) and the new person gets its messages.
  */
  moveOwner: (id, fromUserId, to, entry) => MetaLead.findOneAndUpdate(
    { _id: id, followingUpBy: fromUserId },
    {
      $set: {
        followingUpBy: to?.userId ?? null, followingUpName: to?.name ?? '', followingUpAt: to?.at ?? null,
        ...(to ? {} : { nextFollowUpAt: null }), ...NO_MESSAGES, ...toSheet(entry.at),
      },
      $inc: bumpSheet,
      $push: logEntry(entry),
    },
    after,
  ).lean(),

  /** Save a follow-up, only if owner and last follow-up are what the caller saw. Null = they changed. */
  recordFollowUp: (id, { ownerId, seenAt, status, at, entry, nextAt = null, late = null }) => MetaLead.findOneAndUpdate(
    { _id: id, followingUpBy: ownerId, followUpStatusAt: seenAt ?? null },
    {
      $set: {
        followUpStatus: status, followUpStatusAt: at, nextFollowUpAt: nextAt, ...NO_MESSAGES, ...toSheet(at),
        ...(late && { lateReason: late.reason, lateReasonFor: late.dueAt }),
      },
      $inc: bumpSheet,
      $push: logEntries(late ? [late.entry, entry] : [entry]),
    },
    after,
  ).lean(),

  /** Move the next follow-up, only if it is still what the caller saw. Null = it changed. */
  reschedule: (id, { ownerId, seenNextAt, nextAt, at, entry, late = null }) => MetaLead.findOneAndUpdate(
    { _id: id, followingUpBy: ownerId, nextFollowUpAt: seenNextAt ?? null },
    {
      $set: { nextFollowUpAt: nextAt, ...NO_MESSAGES, ...toSheet(at), ...(late && { lateReason: late.reason, lateReasonFor: late.dueAt }) },
      $inc: { ...bumpSheet, reschedules: 1 },
      $push: logEntries(late ? [late.entry, entry] : [entry]),
    },
    after,
  ).lean(),

  /** Ask for an explanation, only if none is open. Null = one already is. */
  askExplanation: (id, explanation, entry) => MetaLead.findOneAndUpdate(
    { _id: id, $or: [{ explanation: null }, { 'explanation.answeredAt': { $type: 'date' } }] },
    { $set: { explanation }, $push: logEntry(entry) },
    after,
  ).lean(),

  /** Answer the open explanation asked at `askedAt`. Null = it was answered or replaced. */
  answerExplanation: (id, askedAt, { answer, at }, entry) => MetaLead.findOneAndUpdate(
    { _id: id, 'explanation.askedAt': askedAt, 'explanation.answeredAt': null },
    { $set: { 'explanation.answer': answer, 'explanation.answeredAt': at }, $push: logEntry(entry) },
    after,
  ).lean(),

  // -- deadlines (services/metaLeadDeadlineService.js) --
  /** Held leads whose deadline falls in [from, to) and whose `flag` was not sent for it. */
  findDue: (from, to, flag, limit = 500) => MetaLead.find(
    { nextFollowUpAt: { $gte: from, $lt: to }, followingUpBy: { $ne: null }, $expr: { $ne: [`$${flag}`, '$nextFollowUpAt'] } },
    { followingUpBy: 1, followingUpName: 1, nextFollowUpAt: 1, product: 1, tab: 1 },
  ).limit(limit).lean(),

  /** Claim one message for one deadline: true for exactly one caller. */
  async markSent(id, flag, deadline) {
    const res = await MetaLead.updateOne({ _id: id, nextFollowUpAt: deadline, [flag]: { $ne: deadline } }, { $set: { [flag]: deadline } });
    return res.modifiedCount === 1;
  },

  countOverdue: (now, ownerId) => MetaLead.countDocuments({ nextFollowUpAt: { $lt: now }, ...(ownerId ? { followingUpBy: ownerId } : { followingUpBy: { $ne: null } }) }),
  countDueBy: (until, ownerId) => MetaLead.countDocuments({ nextFollowUpAt: { $lt: until }, followingUpBy: ownerId }),
  countOpenExplanations: (ownerId) => MetaLead.countDocuments({ followingUpBy: ownerId, 'explanation.askedAt': { $type: 'date' }, 'explanation.answeredAt': null }),

  /** Team activity: every history entry in [from, to), newest first. */
  activity: (from, to) => MetaLead.aggregate([
    { $match: { 'followUpLog.at': { $gte: from, $lt: to } } },
    { $project: { tab: 1, product: 1, followUpLog: 1 } },
    { $unwind: '$followUpLog' },
    { $match: { 'followUpLog.at': { $gte: from, $lt: to } } },
    { $sort: { 'followUpLog.at': -1 } },
    { $project: { _id: 0, leadId: '$_id', tab: 1, product: 1, e: '$followUpLog' } },
  ]).allowDiskUse(true),

  /** Per person right now: held, overdue, due before `until`, explanations open. */
  holdings: (now, until) => MetaLead.aggregate([
    { $match: { followingUpBy: { $ne: null } } },
    { $group: {
      _id: '$followingUpBy',
      name: { $last: '$followingUpName' },
      holding: { $sum: 1 },
      overdue: { $sum: { $cond: [{ $and: [{ $gt: ['$nextFollowUpAt', null] }, { $lt: ['$nextFollowUpAt', now] }] }, 1, 0] } },
      dueToday: { $sum: { $cond: [{ $and: [{ $gte: ['$nextFollowUpAt', now] }, { $lt: ['$nextFollowUpAt', until] }] }, 1, 0] } },
      openExplanations: { $sum: { $cond: [{ $and: [{ $gt: ['$explanation.askedAt', null] }, { $not: [{ $gt: ['$explanation.answeredAt', null] }] }] }, 1, 0] } },
    } },
    { $sort: { name: 1 } },
  ]),

  /** Overdue leads, oldest deadline first, for the managers' list. */
  overdueList: (now, limit = 100) => MetaLead.find(
    { nextFollowUpAt: { $lt: now }, followingUpBy: { $ne: null } },
    { followingUpBy: 1, followingUpName: 1, nextFollowUpAt: 1, product: 1, tab: 1, name: 1, lateReason: 1, lateReasonFor: 1, explanation: 1 },
  ).sort({ nextFollowUpAt: 1 }).limit(limit).lean(),

  // -- panel -> sheet (services/metaLeadSheetWriter.js) --
  findSheetDirty: (limit = SHEET_WRITE_BATCH) => MetaLead.find({ sheetDirty: true }, WRITE_FIELDS).sort({ sheetChangedAt: 1 }).limit(limit).lean(),
  countSheetDirty: () => MetaLead.countDocuments({ sheetDirty: true }),
  countSheetNotFound: () => MetaLead.countDocuments({ sheetWriteError: { $in: ['not_in_sheet', 'ambiguous'] } }),

  /** Settle written leads: clean only if nothing changed since they were read. */
  settleSheetWrites: (results, at) => {
    const ops = results.map(({ id, wanted, error }) => ({
      updateOne: { filter: { _id: id, sheetWanted: wanted }, update: { $set: { sheetDirty: false, sheetWrittenAt: at, sheetWriteError: error } } },
    }));
    return ops.length ? MetaLead.bulkWrite(ops, { ordered: false }) : null;
  },

  bulkWrite: (ops) => (ops.length ? MetaLead.bulkWrite(ops, { ordered: false }) : null),

  /** Apply a person's edit only if nobody else saved first. Null = they did. */
  applyEdit: (id, revision, update, arrayFilters) => {
    const withSheet = { ...update, $set: { ...update.$set, ...toSheet(new Date()) }, $inc: { ...update.$inc, ...bumpSheet } };
    return MetaLead.findOneAndUpdate({ _id: id, revision }, withSheet, { ...after, arrayFilters }).lean();
  },

  getState: () => MetaLeadSyncState.findById(STATE_ID).lean(),

  saveState: (patch) => MetaLeadSyncState.updateOne({ _id: STATE_ID }, { $set: patch }, { upsert: true }),
};

export default metaLeadRepository;
