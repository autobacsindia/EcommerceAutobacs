import express from "express";
import { 
  createReturnRequest, 
  getMyReturns, 
  getAllReturns, 
  updateReturnStatus,
  getWallet
} from "../controllers/returnController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.route("/")
  .post(protect, createReturnRequest);

router.route("/my-returns")
  .get(protect, getMyReturns);

router.route("/wallet")
  .get(protect, getWallet);

router.route("/admin/all")
  .get(protect, admin, getAllReturns);

router.route("/:id/status")
  .put(protect, admin, updateReturnStatus);

export default router;
