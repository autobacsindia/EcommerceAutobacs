import express from "express";
import { 
  createReturnRequest, 
  getMyReturns, 
  getAllReturns, 
  updateReturnStatus,
  getWallet
} from "../controllers/returnController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { check, param, validationResult } from "express-validator";

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.route("/")
  .post(protect, [
    check('orderId', 'Valid Order ID is required').isMongoId(),
    check('type', 'Invalid return type').isIn(['return', 'exchange']),
    check('items', 'Items must be an array').isArray({ min: 1 }),
    check('items.*.productId', 'Valid Product ID is required').isMongoId(),
    check('items.*.quantity', 'Quantity must be at least 1').isInt({ min: 1 }),
    check('items.*.reason', 'Invalid reason').isIn(['defective', 'wrong_item', 'other']),
    check('items.*.condition', 'Invalid condition').optional().isIn(['unopened', 'opened', 'damaged']),
    check('refundMethod', 'Invalid refund method').optional().isIn(['store_credit', 'original_payment']),
    validate
  ], createReturnRequest);

router.route("/my-returns")
  .get(protect, getMyReturns);

router.route("/wallet")
  .get(protect, getWallet);

router.route("/admin/all")
  .get(protect, admin, getAllReturns);

router.route("/:id/status")
  .put(protect, admin, [
    param('id', 'Invalid Return Request ID').isMongoId(),
    check('status', 'Invalid status').isIn(['pending', 'approved', 'rejected', 'item_received', 'completed', 'cancelled']),
    check('rejectionReason').if(check('status').equals('rejected')).notEmpty().withMessage('Rejection reason is required when rejecting'),
    validate
  ], updateReturnStatus);

export default router;
