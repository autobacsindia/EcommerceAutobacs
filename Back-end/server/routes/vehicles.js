import express from "express";
import Vehicle from "../models/Vehicle.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  validateVehicleUpdate,
  validateVehicleProductMap,
  validateIdParam,
  validateRouteProductId,
  validateMakeModelParam,
  validateVehicleQuery,
} from "../middleware/validationMiddleware.js";
import { publicCacheResponse, invalidatePublicCache } from "../middleware/publicCacheMiddleware.js";

const router = express.Router();

// @route   GET /vehicles
// @desc    Get all active vehicles
// @access  Public
router.get("/", publicCacheResponse('VEHICLE_LIST'), asyncHandler(async (req, res) => {
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
router.get("/makes", publicCacheResponse('VEHICLE_MAKES'), asyncHandler(async (req, res) => {
  try {
    const Vehicle = (await import('../models/Vehicle.js')).default;
    const makes = await Vehicle.distinct("make", { isActive: true }).sort();
    
    console.log(`vehicles/makes: Found ${makes.length} makes`);

    res.json({
      success: true,
      count: makes.length,
      makes
    });
  } catch (error) {
    console.error('Error in vehicles/makes:', error);
    console.error('Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicle makes',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
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

// @route   GET /vehicles/slug/:slug
// @desc    Get vehicle by slug
// @access  Public
router.get('/slug/:slug', asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findOne({ slug: req.params.slug, isActive: true });

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

// @route   GET /vehicles/make-model/:make/:model
// @desc    Get vehicle by make and model
// @access  Public
router.get('/make-model/:make/:model', validateMakeModelParam, asyncHandler(async (req, res) => {
  // Case-insensitive search for vehicle by make and model
  const vehicle = await Vehicle.findOne({ 
    make: { $regex: new RegExp(`^${req.params.make}$`, 'i') },
    model: { $regex: new RegExp(`^${req.params.model}$`, 'i') },
    isActive: true 
  });

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

// @route   GET /vehicles/make-model/:make/:model/products
// @desc    Get products mapped to a vehicle by make and model (PUBLIC)
// @access  Public
router.get('/make-model/:make/:model/products', validateMakeModelParam, asyncHandler(async (req, res) => {
  // Case-insensitive search for vehicle by make and model
  const vehicle = await Vehicle.findOne({ 
    make: { $regex: new RegExp(`^${req.params.make}$`, 'i') },
    model: { $regex: new RegExp(`^${req.params.model}$`, 'i') },
    isActive: true 
  });

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search;

  const query = {
    compatibleVehicles: vehicle._id,
    isActive: true
  };

  if (search) {
    query.name = { $regex: search, $options: 'i' };
  }

  const total = await Product.countDocuments(query);

  const products = await Product.find(query)
    .select('name price images brand slug stock')
    .skip((page - 1) * limit)
    .limit(limit);

  res.json({
    success: true,
    vehicle: {
      id: vehicle._id,
      name: `${vehicle.make} ${vehicle.model}`,
      slug: vehicle.slug,
      productCount: total
    },
    products,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit
    }
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

  invalidatePublicCache('vehicles');

  res.status(201).json({
    success: true,
    message: 'Vehicle created successfully',
    vehicle
  });
}));

// @route   PUT /vehicles/:id
// @desc    Update vehicle
// @access  Private/Admin
router.put("/:id", protect, admin, validateVehicleUpdate, asyncHandler(async (req, res) => {
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

  invalidatePublicCache('vehicles');

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

  invalidatePublicCache('vehicles');

  res.json({
    success: true,
    message: 'Vehicle deleted successfully'
  });
}));

// @route   GET /vehicles/admin/all
// @desc    Get all vehicles (including inactive) for admin
// @access  Private/Admin
router.get("/admin/all", protect, admin, asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';

  const query = search
    ? {
        $or: [
          { make: { $regex: search, $options: 'i' } },
          { model: { $regex: search, $options: 'i' } },
          { variant: { $regex: search, $options: 'i' } }
        ]
      }
    : {};

  const total = await Vehicle.countDocuments(query);
  const vehicles = await Vehicle.find(query)
    .sort({ make: 1, model: 1, year: 1 })
    .skip((page - 1) * limit)
    .limit(limit);

  // Get product counts for each vehicle
  const vehiclesWithCounts = await Promise.all(
    vehicles.map(async (vehicle) => {
      const productCount = await Product.countDocuments({
        compatibleVehicles: vehicle._id,
        isActive: true
      });
      return {
        ...vehicle.toObject(),
        productCount
      };
    })
  );

  res.json({
    success: true,
    vehicles: vehiclesWithCounts,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
    }
  });
}));

// @route   PATCH /vehicles/:id/toggle-status
// @desc    Toggle vehicle active status
// @access  Private/Admin
router.patch("/:id/toggle-status", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  vehicle.isActive = !vehicle.isActive;
  await vehicle.save();

  invalidatePublicCache('vehicles');

  res.json({
    success: true,
    message: `Vehicle ${vehicle.isActive ? 'activated' : 'deactivated'} successfully`,
    vehicle
  });
}));

// @route   GET /vehicles/:id/products
// @desc    Get products mapped to a vehicle
// @access  Private/Admin
router.get("/:id/products", protect, admin, validateIdParam, validateVehicleQuery, asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search;

  const query = {
    compatibleVehicles: vehicle._id,
    isActive: true
  };

  if (search) {
    query.name = { $regex: search, $options: 'i' };
  }

  const total = await Product.countDocuments(query);

  const products = await Product.find(query)
    .select('name price images brand')
    .skip((page - 1) * limit)
    .limit(limit);

  res.json({
    success: true,
    vehicle: {
      id: vehicle._id,
      name: `${vehicle.make} ${vehicle.model}`,
      slug: vehicle.slug,
      productCount: total
    },
    products,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit
    }
  });
}));

// @route   POST /vehicles/:id/products/map
// @desc    Map products to a vehicle
// @access  Private/Admin
router.post("/:id/products/map", protect, admin, validateVehicleProductMap, asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  const { productIds } = req.body;

  // Add vehicle to products' compatibleVehicles array
  const result = await Product.updateMany(
    {
      _id: { $in: productIds },
      compatibleVehicles: { $ne: vehicle._id }
    },
    {
      $addToSet: { compatibleVehicles: vehicle._id }
    }
  );

  res.json({
    success: true,
    message: `Successfully mapped ${result.modifiedCount} products to ${vehicle.make} ${vehicle.model}`,
    modifiedCount: result.modifiedCount
  });
}));

// @route   DELETE /vehicles/:id/products/:productId
// @desc    Unmap a product from a vehicle
// @access  Private/Admin
router.delete("/:id/products/:productId", protect, admin, validateIdParam, validateRouteProductId, asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findById(req.params.id);

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  const product = await Product.findById(req.params.productId);

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  // Remove vehicle from product's compatibleVehicles array
  product.compatibleVehicles = product.compatibleVehicles.filter(
    vehicleId => vehicleId.toString() !== vehicle._id.toString()
  );
  await product.save();

  res.json({
    success: true,
    message: 'Product unmapped successfully'
  });
}));

// @route   GET /vehicles/:id
// @desc    Get vehicle by ID
// @access  Public
// NOTE: This route MUST be at the end to avoid catching specific routes like /make-model, /slug, etc.
router.get('/:id', validateIdParam, asyncHandler(async (req, res) => {
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

export default router;