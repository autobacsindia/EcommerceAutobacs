import express from "express";
import { 
  createReturnRequest, 
  getMyReturns, 
  getAllReturns, 
  updateReturnStatus,
  getWallet
} from "../controllers/returnController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { validateReturnRequest, validateReturnStatus } from "../middleware/validationMiddleware.js";

const router = express.Router();

router.route("/")
  .post(protect, validateReturnRequest, createReturnRequest);

router.route("/my-returns")
  .get(protect, getMyReturns);

router.route("/wallet")
  .get(protect, getWallet);

router.route("/admin/all")
  .get(protect, admin, getAllReturns);

router.route("/:id/status")
  .put(protect, admin, validateReturnStatus, updateReturnStatus);

export default router;
