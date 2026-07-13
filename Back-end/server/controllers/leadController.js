/**
 * Lead (Sales CRM) controller — admin-guarded worklist over the unified Lead
 * pipeline. Sales reps operate as admins (no separate role); ownership is a
 * shared pool with atomic self-claim. All status writes funnel through
 * leadSyncService so the Consultation mirror stays consistent.
 */

import mongoose from 'mongoose';
import leadRepository from '../repositories/leadRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import salesRepRepository from '../repositories/salesRepRepository.js';
import leadSyncService from '../services/leadSyncService.js';
import { resolveRep } from '../utils/salesRepResolver.js';
import { escapeRegex, phoneSearchPattern } from '../utils/identity.js';
import { LEAD_STATUSES, SOURCE_TYPES } from '../config/leadConstants.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_BULK = 200; // cap fan-out on bulk actions

// A lead becomes `won` ONLY through a real order — a paid online order or an
// admin offline order, both of which convert via leadSyncService directly. The
// manual status endpoints reject `won` so reps can't create a hollow win (a Won
// lead with no order behind it, no customer tag, no LTV).
const WON_MANUAL_BLOCK_MSG =
  'A lead is marked Won only by a paid online order or an offline order — it cannot be set manually.';

// Order of the active (workable) stages. The pipeline moves FORWARD only.
const ACTIVE_RANK = { new: 0, contacted: 1, qualified: 2 };

/**
 * Rules for a MANUAL (rep-driven) status change. `won` is handled separately
 * (order-backed only). Returns an error message, or null if allowed.
 *   • won / lost are terminal — a closed lead is never edited by hand; only a
 *     fresh customer signal reopens it (leadSyncService reopen-with-history).
 *   • active stages move forward only (no contacted → new).
 *   • a live lead can always be marked lost.
 */
function manualTransitionError(from, to) {
  if (from === to) return null; // no-op; the service short-circuits it anyway
  if (from === 'won' || from === 'lost') {
    return `This lead is closed (${from}) and can't be changed by hand — a new signal from the customer reopens it automatically.`;
  }
  if (to === 'lost') return null; // a live lead can always be marked lost
  if (ACTIVE_RANK[to] <= ACTIVE_RANK[from]) {
    return `Leads move forward only — a ${from} lead can't go back to ${to}.`;
  }
  return null;
}

/** Build the Mongo query for the list from validated query params. */
// Whitelisted sort orders (label → Mongo sort). Prevents arbitrary sort injection.
const SORT_OPTIONS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  recent_contact: { lastContactedAt: -1 },
  follow_up: { nextFollowUpAt: 1 },
};

function buildListQuery(req) {
  const {
    status, source, assignment, hasPurchased, search, createdFrom, createdTo, followUpDue,
    rep, reopened, neverContacted, lostReason,
  } = req.query;
  const query = {};

  if (status && LEAD_STATUSES.includes(status)) query.status = status;
  if (source && SOURCE_TYPES.includes(source)) query['sources.type'] = source;

  // Ownership is a named SalesRep profile now (no per-user login).
  if (assignment === 'unassigned') query.assignedRep = null;
  // A specific rep's queue. Ignore a malformed id rather than throwing a CastError.
  else if (rep && mongoose.isValidObjectId(rep)) query.assignedRep = rep;

  if (hasPurchased === 'true') query.hasPurchased = true;
  else if (hasPurchased === 'false') query.hasPurchased = false;

  // Segments (pure Lead fields — cheap + indexed).
  if (reopened === 'true') query.reopenCount = { $gt: 0 };
  if (neverContacted === 'true') query.lastContactedAt = null;
  // typeof guard: a repeated query param arrives as an array; .trim() would 500.
  if (typeof lostReason === 'string' && lostReason.trim()) query.lostReason = { $regex: lostReason.trim(), $options: 'i' };

  // Created-date range (either bound optional). Invalid dates are ignored.
  const from = createdFrom ? new Date(createdFrom) : null;
  const to = createdTo ? new Date(createdTo) : null;
  const range = {};
  if (from && !isNaN(from)) range.$gte = from;
  if (to && !isNaN(to)) {
    to.setHours(23, 59, 59, 999); // inclusive end-of-day
    range.$lte = to;
  }
  if (Object.keys(range).length) query.createdAt = range;

  // Leads flagged for follow-up whose date has arrived (from the stale-lead sweep).
  if (followUpDue === 'true') query.nextFollowUpAt = { $ne: null, $lte: new Date() };

  if (typeof search === 'string' && search.trim()) {
    const term = search.trim();
    // Escape before $regex (injection / ReDoS guard).
    const rx = { $regex: escapeRegex(term), $options: 'i' };
    const or = [{ name: rx }, { email: rx }];
    // `Lead.phone` is stored normalized (last-10 digits), so a formatted query
    // (+91, spaces, leading 0) won't match a raw regex — normalize it and match
    // separator-tolerantly. Falls back to a literal phone regex for partials.
    const phonePattern = phoneSearchPattern(term);
    or.push({ phone: { $regex: phonePattern || escapeRegex(term) } });
    query.$or = or;
  }
  return query;
}

// @desc    List leads (paginated, filtered)
// @route   GET /leads
// @access  Private/Admin
export const listLeads = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  const query = buildListQuery(req);
  const sort = SORT_OPTIONS[req.query.sort] || SORT_OPTIONS.newest;

  const [leads, total] = await Promise.all([
    leadRepository.find(query, {
      skip,
      limit,
      sort,
      populate: [{ path: 'assignedRep', select: 'name isActive' }],
    }),
    leadRepository.count(query),
  ]);

  res.json({
    success: true,
    leads,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  });
};

// @desc    Pipeline stats (status counts + pool/my-queue sizes)
// @route   GET /leads/stats
// @access  Private/Admin
export const getLeadStats = async (req, res) => {
  const due = { nextFollowUpAt: { $ne: null, $lte: new Date() } };
  const [byStatus, unassigned, total, followUpDue] = await Promise.all([
    leadRepository.statusCounts({}),
    leadRepository.count({ assignedRep: null, status: { $in: ['new', 'contacted', 'qualified'] } }),
    leadRepository.count({}),
    leadRepository.count(due),
  ]);

  res.json({ success: true, stats: { byStatus, unassigned, total, followUpDue } });
};

// @desc    Assignable sales reps (for the assign dropdown + rep filter)
// @route   GET /leads/reps
// @access  Private/Admin
export const listReps = async (req, res) => {
  const reps = await salesRepRepository.findActive();
  res.json({ success: true, reps });
};

// @desc    Lead detail (sources + existing-customer order history)
// @route   GET /leads/:id
// @access  Private/Admin
export const getLeadById = async (req, res) => {
  const lead = await leadRepository.findById(req.params.id, [
    { path: 'assignedRep', select: 'name isActive' },
    { path: 'assignedTo', select: 'name email' },
    { path: 'contactedBy', select: 'name email' },
    { path: 'linkedUser', select: 'name email phone hasPurchased paidOrderCount firstPurchaseAt lastOrderAt totalSpentPaise' },
    { path: 'sources.ref' },
    { path: 'activities.by', select: 'name email' },
    { path: 'activities.rep', select: 'name' },
    { path: 'convertedOrder', select: 'orderNumber totalAmount status createdAt' },
    // Cycle headers on the Journey timeline show who won it + the closing order.
    { path: 'cycles.assignedRep', select: 'name' },
    { path: 'cycles.convertedOrder', select: 'orderNumber' },
  ]);

  if (!lead) {
    return res.status(404).json({ success: false, message: 'Lead not found' });
  }

  // If this identity already has an account, surface their recent orders so the
  // rep sees purchase history at a glance.
  let orderHistory = [];
  if (lead.linkedUser?._id) {
    orderHistory = await orderRepository.findByUser(lead.linkedUser._id, { limit: 20 });
  }

  res.json({ success: true, lead, orderHistory });
};

// @desc    Claim an unassigned lead FOR a named rep (atomic)
// @route   POST /leads/:id/claim   body: { repId }
// @access  Private/Admin
export const claimLead = async (req, res) => {
  const { rep, error } = await resolveRep(req.body.repId);
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  const lead = await leadSyncService.claimLead(req.params.id, rep._id, req.user.id);
  if (!lead) {
    return res.status(409).json({ success: false, message: 'Lead is already claimed by another rep' });
  }
  res.json({ success: true, lead });
};

// @desc    Release a lead back to the shared pool
// @route   POST /leads/:id/release
// @access  Private/Admin
export const releaseLead = async (req, res) => {
  const lead = await leadSyncService.releaseLead(req.params.id, req.user.id);
  if (!lead) {
    return res.status(404).json({ success: false, message: 'Lead not found' });
  }
  res.json({ success: true, lead });
};

// @desc    Assign/reassign a lead to a specific rep (or unassign with repId=null)
// @route   POST /leads/:id/assign   body: { repId | null }
// @access  Private/Admin
export const assignLead = async (req, res) => {
  const { repId } = req.body; // SalesRep id, or null/'' to unassign
  let assignRep = null;
  if (repId) {
    const { rep, error } = await resolveRep(repId);
    if (error) return res.status(error.status).json({ success: false, message: error.message });
    assignRep = rep._id;
  }
  const lead = await leadRepository.update(req.params.id, {
    $set: {
      assignedRep: assignRep,
      assignedTo: assignRep ? req.user.id : null,
      assignedAt: assignRep ? new Date() : null,
    },
    $push: {
      activities: {
        type: 'assignment',
        by: req.user.id,
        rep: assignRep,
        at: new Date(),
        notes: assignRep ? 'Reassigned by admin' : 'Unassigned by admin',
        meta: { repId: assignRep },
      },
    },
  });
  if (!lead) {
    return res.status(404).json({ success: false, message: 'Lead not found' });
  }
  res.json({ success: true, lead });
};

// @desc    Update lead status (single write path → mirrors consultancy)
// @route   PATCH /leads/:id/status
// @access  Private/Admin
export const updateLeadStatus = async (req, res) => {
  const { status, notes, lostReason, repId } = req.body;
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status value' });
  }
  if (status === 'won') {
    return res.status(400).json({ success: false, message: WON_MANUAL_BLOCK_MSG });
  }
  // Enforce the manual transition rules (forward-only; won/lost are terminal).
  const currentLead = await leadRepository.findById(req.params.id);
  if (!currentLead) {
    return res.status(404).json({ success: false, message: 'Lead not found' });
  }
  const transitionErr = manualTransitionError(currentLead.status, status);
  if (transitionErr) {
    return res.status(400).json({ success: false, message: transitionErr });
  }
  // repId (which rep made the change) is optional; validate only if supplied.
  if (repId) {
    // Crediting an action on an already-owned lead — allow a since-deactivated owner.
    const { error } = await resolveRep(repId, { requireActive: false });
    if (error) return res.status(error.status).json({ success: false, message: error.message });
  }
  const lead = await leadSyncService.applyLeadStatus(req.params.id, status, {
    actorId: req.user.id,
    repId: repId || null,
    notes,
    lostReason,
  });
  if (!lead) {
    return res.status(404).json({ success: false, message: 'Lead not found' });
  }
  res.json({ success: true, lead });
};

// @desc    Log an interaction (call/note/email) + optional follow-up
// @route   POST /leads/:id/activity
// @access  Private/Admin
export const addActivity = async (req, res) => {
  const { type, notes, meta, nextFollowUpAt, repId } = req.body;
  const allowed = ['note', 'call', 'email', 'sms'];
  if (!allowed.includes(type)) {
    return res.status(400).json({ success: false, message: `Activity type must be one of: ${allowed.join(', ')}` });
  }
  if (repId) {
    // Crediting an action on an already-owned lead — allow a since-deactivated owner.
    const { error } = await resolveRep(repId, { requireActive: false });
    if (error) return res.status(error.status).json({ success: false, message: error.message });
  }
  const lead = await leadSyncService.logActivity(req.params.id, {
    type,
    actorId: req.user.id,
    repId: repId || null,
    notes,
    meta,
    nextFollowUpAt,
  });
  if (!lead) {
    return res.status(404).json({ success: false, message: 'Lead not found' });
  }
  res.json({ success: true, lead });
};

// @desc    Bulk self-claim
// @route   POST /leads/bulk/claim
// @access  Private/Admin
export const bulkClaim = async (req, res) => {
  const { leadIds, repId } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, message: 'No lead IDs provided' });
  }
  if (leadIds.length > MAX_BULK) {
    return res.status(400).json({ success: false, message: `Cannot process more than ${MAX_BULK} leads at once` });
  }
  const { rep, error } = await resolveRep(repId);
  if (error) return res.status(error.status).json({ success: false, message: error.message });

  const results = { claimed: [], skipped: [] };
  await Promise.all(
    leadIds.map(async (id) => {
      const lead = await leadSyncService.claimLead(id, rep._id, req.user.id);
      if (lead) results.claimed.push(id);
      else results.skipped.push(id);
    })
  );
  res.json({ success: true, results });
};

// @desc    Bulk status update
// @route   POST /leads/bulk/status
// @access  Private/Admin
export const bulkStatus = async (req, res) => {
  const { leadIds, status, notes, repId } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, message: 'No lead IDs provided' });
  }
  if (leadIds.length > MAX_BULK) {
    return res.status(400).json({ success: false, message: `Cannot process more than ${MAX_BULK} leads at once` });
  }
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status value' });
  }
  if (status === 'won') {
    return res.status(400).json({ success: false, message: WON_MANUAL_BLOCK_MSG });
  }
  if (repId) {
    // Crediting an action on an already-owned lead — allow a since-deactivated owner.
    const { error } = await resolveRep(repId, { requireActive: false });
    if (error) return res.status(error.status).json({ success: false, message: error.message });
  }
  // Batch-load current statuses so each lead is checked against the same manual
  // transition rules (forward-only; won/lost terminal) — violators are skipped.
  const docs = await leadRepository.find({ _id: { $in: leadIds } }, { select: 'status', limit: MAX_BULK });
  const statusById = new Map(docs.map((d) => [d._id.toString(), d.status]));

  const results = { successful: [], failed: [], blocked: [] };
  await Promise.all(
    leadIds.map(async (id) => {
      const from = statusById.get(id);
      if (!from) { results.failed.push(id); return; }
      if (manualTransitionError(from, status)) { results.blocked.push(id); return; }
      const lead = await leadSyncService.applyLeadStatus(id, status, { actorId: req.user.id, repId: repId || null, notes });
      if (lead) results.successful.push(id);
      else results.failed.push(id);
    })
  );
  res.json({ success: true, results });
};
