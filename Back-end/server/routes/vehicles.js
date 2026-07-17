import express from "express";
import vehicleRepository from "../repositories/vehicleRepository.js";
import Product, { enqueueProductSync } from "../models/Product.js";
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
import { uploadSingle, handleMulterError, validateUploadedFiles, concurrentUploadGuard } from "../middleware/uploadMiddleware.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryHelpers.js";

const router = express.Router();

// @route   GET /vehicles
// @desc    Get all active vehicles
// @access  Public
router.get("/", publicCacheResponse('VEHICLE_LIST'), asyncHandler(async (req, res) => {
  const vehicles = await vehicleRepository.find({ isActive: true })
    .sort({ make: 1, model: 1 });

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
    const makes = await vehicleRepository.distinct("make", { isActive: true }).sort();
    
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
  const models = await vehicleRepository.distinct("model", { 
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
  const vehicle = await vehicleRepository.findOne({ slug: req.params.slug, isActive: true });

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
  const vehicle = await vehicleRepository.findOne({ 
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
  const vehicle = await vehicleRepository.findOne({ 
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
// @desc    Create new vehicle (optionally with image file upload)
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  concurrentUploadGuard,
  uploadSingle('image'),
  handleMulterError,
  validateUploadedFiles,
  asyncHandler(async (req, res) => {
    const { make, model, slug, imageAlt, isActive } = req.body;

    if (!make || !model || !slug) {
      return res.status(400).json({
        success: false,
        message: 'Make, model, and slug are required'
      });
    }

    // Image: prefer an uploaded file (→ Cloudinary); fall back to a pasted URL
    // string for backward compatibility. Undefined when neither is provided.
    let image;
    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.buffer, { folder: 'autobacs/vehicles' });
      image = { url: uploaded.secure_url, public_id: uploaded.public_id, alt: imageAlt || `${make} ${model}` };
    } else if (req.body.image) {
      image = { url: req.body.image, alt: imageAlt || `${make} ${model}` };
    }

    const vehicle = await vehicleRepository.create({
      make,
      model,
      slug,
      image,
      // Multipart sends booleans as strings; default active when unspecified.
      ...(isActive !== undefined ? { isActive: isActive === true || isActive === 'true' } : {}),
    });

    invalidatePublicCache('vehicles');

    res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      vehicle
    });
  })
);

// @route   PUT /vehicles/:id
// @desc    Update vehicle (optionally replace image via file upload)
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  concurrentUploadGuard,
  uploadSingle('image'),
  handleMulterError,
  validateUploadedFiles,
  validateVehicleUpdate,
  asyncHandler(async (req, res) => {
    const vehicle = await vehicleRepository.findById(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    const { make, model, slug, isActive, imageAlt } = req.body;
    if (make !== undefined)  vehicle.make = make;
    if (model !== undefined) vehicle.model = model;
    if (slug !== undefined)  vehicle.slug = slug;
    if (isActive !== undefined) vehicle.isActive = isActive === true || isActive === 'true';

    if (req.file) {
      // Upload the new asset FIRST, then delete the old one only after success —
      // so a failed upload can never leave the vehicle pointing at a deleted image.
      const oldPublicId = vehicle.image?.public_id;
      const uploaded = await uploadToCloudinary(req.file.buffer, { folder: 'autobacs/vehicles' });
      vehicle.image = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
        alt: imageAlt ?? vehicle.image?.alt ?? `${vehicle.make} ${vehicle.model}`,
      };
      if (oldPublicId && oldPublicId !== uploaded.public_id) {
        await deleteFromCloudinary(oldPublicId);
      }
    } else if (typeof req.body.image === 'string') {
      // Pasted URL string (no file). Guard the type so a legacy JSON {url,alt}
      // object can't be coerced into image.url as "[object Object]".
      const newUrl = req.body.image;
      const sameUrl = newUrl === vehicle.image?.url;
      const oldPublicId = vehicle.image?.public_id;
      vehicle.image = {
        url: newUrl,
        public_id: sameUrl ? oldPublicId : undefined,
        alt: imageAlt ?? vehicle.image?.alt ?? `${vehicle.make} ${vehicle.model}`,
      };
      // Different URL replacing an uploaded asset — delete the orphan.
      if (!sameUrl && oldPublicId) {
        await deleteFromCloudinary(oldPublicId);
      }
    } else if (imageAlt !== undefined && vehicle.image) {
      // Only the alt text changed.
      vehicle.image.alt = imageAlt;
    }

    await vehicle.save();
    invalidatePublicCache('vehicles');

    res.json({
      success: true,
      message: 'Vehicle updated successfully',
      vehicle
    });
  })
);

// @route   DELETE /vehicles/:id
// @desc    Delete vehicle (soft delete)
// @access  Private/Admin
router.delete("/:id", protect, admin, asyncHandler(async (req, res) => {
  const vehicle = await vehicleRepository.findById(req.params.id);

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
          { model: { $regex: search, $options: 'i' } }
        ]
      }
    : {};

  const total = await vehicleRepository.countDocuments(query);
  const vehicles = await vehicleRepository.find(query)
    .sort({ make: 1, model: 1 })
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
  const vehicle = await vehicleRepository.findById(req.params.id);

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
  const vehicle = await vehicleRepository.findById(req.params.id);

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
  const vehicle = await vehicleRepository.findById(req.params.id);

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

  // Re-index the mapped products in ES so fitment filters stay accurate
  // (updateMany bypasses the doc hooks). productIds is the exact candidate set;
  // any already-mapped ones re-index to identical data (deduped, harmless).
  enqueueProductSync(productIds);

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
  const vehicle = await vehicleRepository.findById(req.params.id);

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
  const vehicle = await vehicleRepository.findById(req.params.id);

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