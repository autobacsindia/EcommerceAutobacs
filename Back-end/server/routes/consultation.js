import express from "express";
import Consultation from "../models/Consultation.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// ─── PUBLIC: Submit consultation ─────────────────────────────────────────────

// POST /api/v1/consultation
router.post("/", asyncHandler(async (req, res) => {
  const {
    name, whatsapp, city, vehicleNumber, makeModel,
    upgrades, usage, drivingStyle, mode,
    preferredDate, preferredTime, notes,
  } = req.body;

  if (!name || !whatsapp || !city || !makeModel) {
    return res.status(400).json({
      success: false,
      message: "Name, WhatsApp number, city, and vehicle make/model are required.",
    });
  }

  const consultation = await Consultation.create({
    name, whatsapp, city,
    vehicleNumber: vehicleNumber || "",
    makeModel,
    upgrades: Array.isArray(upgrades) ? upgrades : [],
    usage: usage || "",
    drivingStyle: drivingStyle || "",
    mode: mode || "In-Person",
    preferredDate: preferredDate ? new Date(preferredDate) : null,
    preferredTime: preferredTime || "",
    notes: notes || "",
  });

  res.status(201).json({ success: true, data: consultation });
}));

// ─── ADMIN: List all consultations ───────────────────────────────────────────

// GET /api/v1/consultation/admin?status=new&page=1&limit=20
router.get("/admin", protect, admin, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (status && ["new", "contacted", "completed", "cancelled"].includes(status)) {
    query.status = status;
  }
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { whatsapp: { $regex: search, $options: "i" } },
      { makeModel: { $regex: search, $options: "i" } },
      { city: { $regex: search, $options: "i" } },
    ];
  }

  const [consultations, total] = await Promise.all([
    Consultation.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Consultation.countDocuments(query),
  ]);

  // Status counts for tab badges
  const [countNew, countContacted, countCompleted, countCancelled] = await Promise.all([
    Consultation.countDocuments({ status: "new" }),
    Consultation.countDocuments({ status: "contacted" }),
    Consultation.countDocuments({ status: "completed" }),
    Consultation.countDocuments({ status: "cancelled" }),
  ]);

  res.json({
    success: true,
    data: consultations,
    counts: { new: countNew, contacted: countContacted, completed: countCompleted, cancelled: countCancelled },
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
}));

// GET /api/v1/consultation/admin/:id
router.get("/admin/:id", protect, admin, asyncHandler(async (req, res) => {
  const consultation = await Consultation.findById(req.params.id);
  if (!consultation) {
    return res.status(404).json({ success: false, message: "Consultation not found" });
  }
  res.json({ success: true, data: consultation });
}));

// PATCH /api/v1/consultation/admin/:id/status
router.patch("/admin/:id/status", protect, admin, asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!["new", "contacted", "completed", "cancelled"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status value" });
  }

  const consultation = await Consultation.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  );

  if (!consultation) {
    return res.status(404).json({ success: false, message: "Consultation not found" });
  }
  res.json({ success: true, data: consultation });
}));

// DELETE /api/v1/consultation/admin/:id
router.delete("/admin/:id", protect, admin, asyncHandler(async (req, res) => {
  const consultation = await Consultation.findByIdAndDelete(req.params.id);
  if (!consultation) {
    return res.status(404).json({ success: false, message: "Consultation not found" });
  }
  res.json({ success: true, message: "Consultation deleted" });
}));

export default router;
