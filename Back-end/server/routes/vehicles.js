import express from "express";
import Vehicle from "../models/Vehicle.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// @route   GET /vehicles
// @desc    Get all active vehicles
// @access  Public
router.get("/", asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find({ isActive: true })
    .sort({ make: 1, model: 1, year: 1 });

  res.json({
    success: true,
    count: vehicles.length,
    vehicles
  });
}));

// @route   GET /vehicles/makes
// @desc    Get all vehicle makes
// @access  Public
router.get("/makes", asyncHandler(async (req, res) => {
  const makes = await Vehicle.distinct("make", { isActive: true }).sort();

  res.json({
    success: true,
    count: makes.length,
    makes
  });
}));

// @route   GET /vehicles/models/:make
// @desc    Get all models for a specific make
// @access  Public
router.get("/models/:make", asyncHandler(async (req, res) => {
  const models = await Vehicle.distinct("model", { 
    make: req.params.make, 
    isActive: true 
  }).sort();

  res.json({
    success: true,
    count: models.length,
    models
  });
}));

// @route   GET /vehicles/:id
// @desc    Get vehicle by ID
// @access  Public
router.get("/:id", asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  res.json({
    success: true,
    vehicle
  });
}));

// @route   POST /vehicles
// @desc    Create new vehicle
// @access  Private/Admin
router.post("/", protect, admin, asyncHandler(async (req, res) => {
  const { make, model, year, variant, slug, image } = req.body;

  if (!make || !model || !year || !slug) {
    return res.status(400).json({
      success: false,
      message: 'Make, model, year, and slug are required'
    });
  }

  const vehicle = await Vehicle.create({
    make,
    model,
    year,
    variant,
    slug,
    image
  });

  res.status(201).json({
    success: true,
    message: 'Vehicle created successfully',
    vehicle
  });
}));

// @route   PUT /vehicles/:id
// @desc    Update vehicle
// @access  Private/Admin
router.put("/:id", protect, admin, asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  res.json({
    success: true,
    message: 'Vehicle updated successfully',
    vehicle
  });
}));

// @route   DELETE /vehicles/:id
// @desc    Delete vehicle (soft delete)
// @access  Private/Admin
router.delete("/:id", protect, admin, asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  vehicle.isActive = false;
  await vehicle.save();

  res.json({
    success: true,
    message: 'Vehicle deleted successfully'
  });
}));

export default router;