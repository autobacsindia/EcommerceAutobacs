/**
 * Lead (Sales CRM) controller — admin-guarded worklist over the unified Lead
 * pipeline. Sales reps operate as admins (no separate role); ownership is a
 * shared pool with atomic self-claim. All status writes funnel through
 * leadSyncService so the Consultation mirror stays consistent.
 */

import leadRepository from '../repositories/leadRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import leadSyncService from '../services/leadSyncService.js';
import { LEAD_STATUSES, SOURCE_TYPES } from '../config/leadConstants.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Build the Mongo query for the list from validated query params. */
function buildListQuery(req) {
  const { status, source, assignment, hasPurchased, search } = req.query;
  const query = {};

  if (status && LEAD_STATUSES.includes(status)) query.status = status;
  if (source && SOURCE_TYPES.includes(source)) query['sources.type'] = source;

  if (assignment === 'mine') query.assignedTo = req.user.id;
  else if (assignment === 'unassigned') query.assignedTo = null;

  if (hasPurchased === 'true') query.hasPurchased = true;
  else if (hasPurchased === 'false') query.hasPurchased = false;

  if (search) {
    const rx = { $regex: search.trim(), $options: 'i' };
    query.$or = [{ name: rx }, { email: rx }, { phone: rx }];
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

  const [leads, total] = await Promise.all([
    leadRepository.find(query, {
      skip,
      limit,
      sort: { createdAt: -1 },
      populate: [{ path: 'assignedTo', select: 'name email' }],
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
  const [byStatus, unassigned, mine, total] = await Promise.all([
    leadRepository.statusCounts({}),
    leadRepository.count({ assignedTo: null, status: { $in: ['new', 'contacted', 'qualified'] } }),
    leadRepository.count({ assignedTo: req.user.id, status: { $in: ['new', 'contacted', 'qualified'] } }),
    leadRepository.count({}),
  ]);

  res.json({ success: true, stats: { byStatus, unassigned, mine, total } });
};

// @desc    Lead detail (sources + existing-customer order history)
// @route   GET /leads/:id
// @access  Private/Admin
export const getLeadById = async (req, res) => {
  const lead = await leadRepository.findById(req.params.id, [
    { path: 'assignedTo', select: 'name email' },
    { path: 'contactedBy', select: 'name email' },
    { path: 'linkedUser', select: 'name email phone hasPurchased paidOrderCount firstPurchaseAt' },
    { path: 'sources.ref' },
    { path: 'activities.by', select: 'name email' },
    { path: 'convertedOrder', select: 'orderNumber totalAmount status createdAt' },
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

// @desc    Self-claim an unassigned lead (atomic)
// @route   POST /leads/:id/claim
// @access  Private/Admin
export const claimLead = async (req, res) => {
  const lead = await leadSyncService.claimLead(req.params.id, req.user.id);
  if (!lead) {
    return res.status(409).json({ success: false, message: 'Lead is already claimed by someone else' });
  }
  res.json({ success: true, lead });
};

// @desc    Release a lead back to the shared pool
// @route   POST /leads/:id/release
// @access  Private/Admin
export const releaseLead = async (req, res) => {
  // Admins can force-release any lead; a rep can only release their own.
  const lead = await leadSyncService.releaseLead(req.params.id, req.user.id, { force: true });
  if (!lead) {
    return res.status(404).json({ success: false, message: 'Lead not found' });
  }
  res.json({ success: true, lead });
};

// @desc    Assign a lead to a specific rep (manager override)
// @route   POST /leads/:id/assign
// @access  Private/Admin
export const assignLead = async (req, res) => {
  const { assignTo } = req.body; // userId or null to unassign
  const lead = await leadRepository.update(req.params.id, {
    $set: { assignedTo: assignTo || null, assignedAt: assignTo ? new Date() : null },
    $push: {
      activities: {
        type: 'assignment',
        by: req.user.id,
        at: new Date(),
        notes: assignTo ? 'Reassigned by admin' : 'Unassigned by admin',
        meta: { assignTo: assignTo || null },
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
  const { status, notes, lostReason } = req.body;
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status value' });
  }
  const lead = await leadSyncService.applyLeadStatus(req.params.id, status, {
    actorId: req.user.id,
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
  const { type, notes, meta, nextFollowUpAt } = req.body;
  const allowed = ['note', 'call', 'email', 'sms'];
  if (!allowed.includes(type)) {
    return res.status(400).json({ success: false, message: `Activity type must be one of: ${allowed.join(', ')}` });
  }
  const lead = await leadSyncService.logActivity(req.params.id, {
    type,
    actorId: req.user.id,
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
  const { leadIds } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, message: 'No lead IDs provided' });
  }
  const results = { claimed: [], skipped: [] };
  await Promise.all(
    leadIds.map(async (id) => {
      const lead = await leadSyncService.claimLead(id, req.user.id);
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
  const { leadIds, status, notes } = req.body;
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ success: false, message: 'No lead IDs provided' });
  }
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status value' });
  }
  const results = { successful: [], failed: [] };
  await Promise.all(
    leadIds.map(async (id) => {
      const lead = await leadSyncService.applyLeadStatus(id, status, { actorId: req.user.id, notes });
      if (lead) results.successful.push(id);
      else results.failed.push(id);
    })
  );
  res.json({ success: true, results });
};
