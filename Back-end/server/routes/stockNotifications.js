import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  listMyRequests,
  cancelMyRequest,
  adminListRequests,
  adminListRequesters,
} from "../controllers/stockNotificationController.js";

const router = express.Router();

// ── Customer (self) ────────────────────────────────────────────────────────────

// @route   GET /stock-notifications/mine?productId=
// @desc    The caller's own pending back-in-stock requests
// @access  Private
router.get("/mine", protect, asyncHandler(listMyRequests));

// @route   DELETE /stock-notifications/:id
// @desc    Cancel one of the caller's own pending requests
// @access  Private
router.delete("/:id", protect, asyncHandler(cancelMyRequest));

// ── Admin (Catalog → Stock Requests) ─────────────────────────────────────────

// @route   GET /stock-notifications/admin
// @desc    Pending requests grouped per product/variant (demand signal)
// @access  Private/Admin
router.get("/admin", protect, admin, asyncHandler(adminListRequests));

// @route   GET /stock-notifications/admin/requesters?productId=&variantId=
// @desc    Individual customers waiting on one product/variant
// @access  Private/Admin
router.get("/admin/requesters", protect, admin, asyncHandler(adminListRequesters));

export default router;
