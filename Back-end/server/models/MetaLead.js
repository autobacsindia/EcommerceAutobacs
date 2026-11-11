import mongoose from 'mongoose';
import { FOLLOW_UP_STATUS_KEYS } from '../config/leadConstants.js';

/**
 * MetaLead — one row of the "sales lead sheet" Google Sheet, shown on the Meta
 * leads tab. Deliberately NOT the person-centric Lead (Sales CRM): the sheet is a
 * row-per-enquiry record, the same phone on two campaign tabs is two enquiries,
 * and folding them onto a Lead would lose rows.
 *
 * `sheetKey` is the only identity. Campaign tabs use Meta's own id (`l:…`); the
 * typed-by-hand "website lead" tab has no id, so a row starts with the tab's
 * permanent gid + phone + how many times that phone has appeared in the tab, and
 * then keeps that key: the sync matches rows by their content, so a corrected
 * phone or a deleted row above does not move the work onto another enquiry.
 *
 * The sheet is the feed, the panel is the workspace: services/metaLeadSync.js
 * refreshes everything EXCEPT what someone has edited here (`editedFields`) and
 * the follow-up fields, which it never touches.
 * A row removed from the sheet stays — nothing here is ever deleted by the sync.
 */
const FieldSchema = new mongoose.Schema(
  { label: { type: String, required: true }, value: { type: String, default: '' } },
  { _id: false },
);

const EditSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    changes: [{ _id: false, field: String, from: String, to: String }],
  },
  { _id: false },
);

const FollowUpEntrySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['claim', 'release', 'reassign', 'follow_up', 'reschedule', 'late_reason', 'explain_ask', 'explain_answer'], required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    status: { type: String, enum: FOLLOW_UP_STATUS_KEYS, default: undefined },
    notes: { type: String, default: '' },
    // follow_up / reschedule: the next follow-up it set, and the deadline it answered.
    nextAt: { type: Date, default: undefined },
    dueAt: { type: Date, default: undefined },
    // follow_up: done after its deadline had passed.
    late: { type: Boolean, default: undefined },
    // follow_up: the first one after the lead was taken, this many minutes later.
    minutesSinceClaim: { type: Number, default: undefined },
  },
  { _id: false },
);

const ExplanationSchema = new mongoose.Schema(
  {
    askedAt: { type: Date, required: true },
    askedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    askedByName: { type: String, default: '' },
    question: { type: String, default: '' },
    answer: { type: String, default: '' },
    answeredAt: { type: Date, default: null },
  },
  { _id: false },
);

const MetaLeadSchema = new mongoose.Schema(
  {
    sheetKey: { type: String, required: true },
    metaLeadId: { type: String, default: null },
    tab: { type: String, required: true },
    rowNumber: { type: Number, default: null },

    // The moment of the enquiry; null when the sheet has no date (never guessed).
    leadDate: { type: Date, default: null },
    // The cell exactly as typed, so an unreadable date is not lost.
    dateRaw: { type: String, default: '' },
    dateHasTime: { type: Boolean, default: false },
    // leadDate, or the epoch when undated: keeps keyset paging on a real value,
    // and undated rows after every dated one.
    sortAt: { type: Date, required: true },

    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    // Last 10 digits of `phone`: how the same customer is found on another tab.
    phoneKey: { type: String, default: '' },
    email: { type: String, default: '' },
    product: { type: String, default: '' },
    campaign: { type: String, default: '' },
    salesPerson: { type: String, default: '' },
    status: { type: String, default: '' },
    followUp1: { type: String, default: '' },
    followUp2: { type: String, default: '' },

    // Every column of the row, in sheet order. This is the "no data lost" store.
    fields: { type: [FieldSchema], default: [] },

    // Column names someone changed in the panel; the sync no longer touches them.
    editedFields: { type: [String], default: [] },
    // Bumped only by a person's edit: two editors cannot silently overwrite each other.
    revision: { type: Number, default: 0 },
    edits: { type: [EditSchema], default: [] },
    // Set when the row is no longer in the sheet; the lead and its work stay.
    removedFromSheetAt: { type: Date, default: null },

    // The team's follow-up work. Website only: the sheet sync never reads or
    // writes any of these (services/metaLeadFollowUpService.js owns them).
    followingUpBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    followingUpName: { type: String, default: '' },
    followingUpAt: { type: Date, default: null },
    followUpStatus: { type: String, enum: FOLLOW_UP_STATUS_KEYS, default: null },
    followUpStatusAt: { type: Date, default: null },
    followUpLog: { type: [FollowUpEntrySchema], default: [] },

    // When the next follow-up is due (null = none asked: free, or closed). Set by
    // taking a lead and by every follow-up; services/metaLeadDeadlineService.js
    // reminds before it and escalates after it.
    nextFollowUpAt: { type: Date, default: null },
    // The deadline each message was already sent for: one message per deadline,
    // however often the sweep runs.
    reminderSentFor: { type: Date, default: null },
    escalatedHeadFor: { type: Date, default: null },
    escalatedManagersFor: { type: Date, default: null },
    // Why the deadline `lateReasonFor` was missed (typed by the person following up).
    lateReason: { type: String, default: '' },
    lateReasonFor: { type: Date, default: null },
    reschedules: { type: Number, default: 0 },
    // An open or answered "explain this" from the admin / a head; the history keeps all of them.
    explanation: { type: ExplanationSchema, default: null },

    // Panel → sheet (services/metaLeadSheetWriter.js). Every panel change sets
    // sheetDirty and bumps sheetWanted; a write clears sheetDirty only if
    // sheetWanted is still what it wrote, so a change during the write is not lost.
    sheetDirty: { type: Boolean, default: false },
    sheetWanted: { type: Number, default: 0 },
    sheetChangedAt: { type: Date, default: null },
    sheetWrittenAt: { type: Date, default: null },
    // '' | 'not_in_sheet' | 'ambiguous': why the last write found no row.
    sheetWriteError: { type: String, default: '' },
  },
  { timestamps: true },
);

// Must be built BEFORE the first sync in production (autoIndex is off): it is what
// makes a repeat of the same lead impossible.
MetaLeadSchema.index({ sheetKey: 1 }, { unique: true });
MetaLeadSchema.index({ sortAt: -1, _id: -1 }); // every tab, newest first
MetaLeadSchema.index({ tab: 1, sortAt: -1, _id: -1 }); // one tab, newest first
/*
  Measured on 20,000 rows: Mine / a person, a rare status, and the "also enquired"
  lookup each read all 20,000 per page; with these, 0-26. Not required for the page
  to work, only for it to stay fast (autoIndex is off: build them after deploy).
*/
MetaLeadSchema.index({ followingUpBy: 1, sortAt: -1, _id: -1 }); // Unclaimed / Mine / a person
MetaLeadSchema.index({ followUpStatus: 1, sortAt: -1, _id: -1 }); // by follow-up status
MetaLeadSchema.index({ phoneKey: 1 }); // the same customer on another tab
// Waiting to be written to the sheet: a handful of rows at any moment.
MetaLeadSchema.index({ sheetDirty: 1 }, { partialFilterExpression: { sheetDirty: true }, name: 'meta_lead_sheet_dirty' });
// Deadlines: the minute sweep, "due / overdue", per person.
MetaLeadSchema.index({ nextFollowUpAt: 1 }, { partialFilterExpression: { nextFollowUpAt: { $type: 'date' } }, name: 'meta_lead_next_follow_up' });
MetaLeadSchema.index({ followingUpBy: 1, nextFollowUpAt: 1 }, { partialFilterExpression: { nextFollowUpAt: { $type: 'date' } }, name: 'meta_lead_owner_next_follow_up' });

export default mongoose.model('MetaLead', MetaLeadSchema);
