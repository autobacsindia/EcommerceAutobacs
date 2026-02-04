import express from "express";
import { 
  createReturnRequest, 
  getMyReturns, 
  getAllReturns, 
  updateReturnStatus,
  getWallet
} from "../controllers/returnController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { validateReturnRequest, validateReturnStatusUpdate, validateRefundsQuery } from "../middleware/validationMiddleware.js";

const router = express.Router();

router.route("/")
  .post(protect, validateReturnRequest, createReturnRequest);

router.route("/my-returns")
  .get(protect, getMyReturns);

router.route("/wallet")
  .get(protect, getWallet);

router.route("/admin/all")
  .get(protect, admin, validateRefundsQuery, getAllReturns);

router.route("/:id/status")
  .put(protect, admin, validateIdParam, validateReturnStatusUpdate, updateReturnStatus);

export default router;
