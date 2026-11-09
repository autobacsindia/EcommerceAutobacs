/**
 * The Meta leads tab — /api/v1/staff/meta-leads. Mounted inside routes/staff.js,
 * behind its protect + staffOrAdmin gate. services/metaLeadService.js owns who may
 * do what.
 */
import express from 'express';
import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { listMetaLeads, getMetaLead, updateMetaLead } from '../services/metaLeadService.js';

const router = express.Router();
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v) && String(v).length === 24;
const validId = param('id').custom(isObjectId).withMessage('Invalid lead');

router.get('/', [
  ...['q', 'tab'].map((n) => query(n).optional().isString().isLength({ max: 120 }).withMessage(`Invalid ${n}`)),
  query('cursor').optional().isString().isLength({ max: 200 }).withMessage('Invalid page cursor'),
], validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await listMetaLeads(req.user, req.query)) });
}));

router.get('/:id', validId, validateRequest, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await getMetaLead(req.user, req.params.id)) });
}));

// Someone saved first → 409 with their version, so the form can show it.
router.patch('/:id', [
  validId,
  body('revision').isInt({ min: 0 }).withMessage('Please reload and try again.'),
  body('changes').optional().isObject().withMessage('Invalid changes'),
  body('extras').optional().isObject().withMessage('Invalid changes'),
], validateRequest, asyncHandler(async (req, res) => {
  const { outcome, lead } = await updateMetaLead(req.user, req.params.id, req.body);
  if (outcome === 'changed') {
    return res.status(409).json({ success: false, outcome, message: 'Someone else just changed this lead. Check their version and try again.', lead });
  }
  res.json({ success: true, outcome, lead });
}));

export default router;
