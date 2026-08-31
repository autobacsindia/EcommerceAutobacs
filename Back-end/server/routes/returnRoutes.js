import express from "express";
import {
  getReturnUploadSignature,
  createReturnRequest,
  getMyReturns,
  cancelMyReturn,
  getAllReturns,
  getReturnById,
  reviewReturn,
  bookCourier,
  markReceived,
  recordInspection,
  refundPreview,
  initiateReturnRefund,
  createOfflineReturn,
  markReturnedOffline,
} from "../controllers/returnController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  validateReturnRequest,
  validateReturnReview,
  validateRefundsQuery,
  validateIdParam,
  validateOfflineReturnCreate,
  validateOfflineReceived,
  validateReturnRefundBody,
} from "../middleware/validationMiddleware.js";

const router = express.Router();

// ── Customer ────────────────────────────────────────────────────────────────
router.post("/upload-signature", protect, getReturnUploadSignature);
router.post("/", protect, validateReturnRequest, createReturnRequest);
router.get("/my-returns", protect, getMyReturns);
router.patch("/:id/cancel", protect, validateIdParam, cancelMyReturn);

// ── Admin ─────────────────────────────────────────────────────────────────────
// Static /admin/all must precede the /admin/:id param route.
router.get("/admin/all", protect, admin, validateRefundsQuery, getAllReturns);
// Record a return handled off-platform. Static path, so it must precede /admin/:id.
router.post("/admin", protect, admin, validateOfflineReturnCreate, createOfflineReturn);
router.get("/admin/:id", protect, admin, validateIdParam, getReturnById);
router.patch("/admin/:id/review", protect, admin, validateReturnReview, reviewReturn);
router.patch("/admin/:id/courier", protect, admin, validateIdParam, bookCourier);
router.patch("/admin/:id/received", protect, admin, validateIdParam, markReceived);
// Deliberately NOT a flag on /received: that route refuses to skip the mandatory AWB,
// and this one is the named, note-required, audit-logged exception to it.
router.patch("/admin/:id/offline-received", protect, admin, validateOfflineReceived, markReturnedOffline);
router.patch("/admin/:id/inspection", protect, admin, validateIdParam, recordInspection);
router.get("/admin/:id/refund-preview", protect, admin, validateIdParam, refundPreview);
router.post("/admin/:id/refund", protect, admin, validateReturnRefundBody, initiateReturnRefund);

export default router;
