/**
 * SalesRep (name-only profiles) controller — admin-managed CRM staffing.
 *
 * These are labels, not accounts. Create a name, deactivate when someone leaves.
 * Attribution on leads/orders points at these profiles so "who claimed / closed
 * this" reads as a person's name under the shared admin login.
 */

import salesRepRepository from '../repositories/salesRepRepository.js';

const MAX_NAME = 80;

// @desc    List sales reps (default: active only; ?all=true for management)
// @route   GET /sales-reps
// @access  Private/Admin
export const listSalesReps = async (req, res) => {
  const reps = req.query.all === 'true'
    ? await salesRepRepository.find({}, { sort: { isActive: -1, name: 1 } })
    : await salesRepRepository.findActive();
  res.json({ success: true, reps });
};

// @desc    Create a sales-rep profile
// @route   POST /sales-reps
// @access  Private/Admin
export const createSalesRep = async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return res.status(400).json({ success: false, message: 'Rep name is required' });
  }
  if (name.length > MAX_NAME) {
    return res.status(400).json({ success: false, message: `Name must be ${MAX_NAME} characters or fewer` });
  }
  // Fast-path duplicate check for a friendly message; the unique index is the
  // real guard (catches the concurrent-create race the pre-check can't).
  const existing = await salesRepRepository.findByName(name);
  if (existing) {
    return res.status(409).json({ success: false, message: 'A rep with that name already exists' });
  }
  try {
    const rep = await salesRepRepository.create({ name, createdBy: req.user.id });
    res.status(201).json({ success: true, rep });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'A rep with that name already exists' });
    }
    throw err;
  }
};

// @desc    Rename / activate / deactivate a sales-rep profile
// @route   PATCH /sales-reps/:id
// @access  Private/Admin
export const updateSalesRep = async (req, res) => {
  const update = {};
  if (req.body.name !== undefined) {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ success: false, message: 'Rep name cannot be empty' });
    if (name.length > MAX_NAME) {
      return res.status(400).json({ success: false, message: `Name must be ${MAX_NAME} characters or fewer` });
    }
    const clash = await salesRepRepository.findByName(name);
    if (clash && clash._id.toString() !== req.params.id) {
      return res.status(409).json({ success: false, message: 'A rep with that name already exists' });
    }
    update.name = name;
  }
  if (req.body.isActive !== undefined) update.isActive = !!req.body.isActive;

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }
  try {
    const rep = await salesRepRepository.update(req.params.id, { $set: update });
    if (!rep) return res.status(404).json({ success: false, message: 'Sales rep not found' });
    res.json({ success: true, rep });
  } catch (err) {
    // A rename that collides with another rep trips the unique index.
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'A rep with that name already exists' });
    }
    throw err;
  }
};
