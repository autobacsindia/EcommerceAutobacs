import express from "express";
import vehicleRepository from "../repositories/vehicleRepository.js";
import productRepository from "../repositories/productRepository.js";
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
import { invalidatePublicCache } from "../middleware/publicCacheMiddleware.js";
import auditLogger from "../services/auditLogger.js";
import { httpCache } from "../middleware/httpCache.js";
import { PRIVATE_NO_STORE } from "../config/cacheProfiles.js";
import { uploadSingle, handleMulterError, validateUploadedFiles, concurrentUploadGuard } from "../middleware/uploadMiddleware.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryHelpers.js";

const router = express.Router();

// @route   GET /vehicles
// @desc    Get all active vehicles
// @access  Public
router.get("/", httpCache('VEHICLE_LIST'), asyncHandler(async (req, res) => {
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
router.get("/makes", httpCache('VEHICLE_MAKES'), asyncHandler(async (req, res) => {
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

// @route   GET /vehicles/sitemap
// @desc    Lightweight slug+updatedAt list for sitemap generation
// @access  Public
//
// Only vehicles that have at least one active compatible product. /model/:slug
// 404s solely on a missing Vehicle document, so a vehicle with no products
// still renders — an empty listing page titled "<Vehicle> Accessories". Same
// call as the brands sitemap: submitting those asks Google to crawl pages with
// nothing on them.
//
// `compatibleVehicles` is a real ObjectId ref array (unlike Product.brand,
// which is a denormalised name string), so this joins on ids — which is also
// what the listing page itself filters on, so the sitemap and the page can't
// disagree about which vehicles have products.
router.get('/sitemap', asyncHandler(async (_req, res) => {
  const vehicles = await vehicleRepository
    .find({ isActive: true, slug: { $exists: true, $nin: [null, ''] } })
    .select('slug updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  const withProducts = await productRepository.distinctCompatibleVehicles(
    vehicles.map((v) => v._id),
  );
  const stocked = new Set(withProducts.map((id) => String(id)));

  res.set('Cache-Control', 'public, max-age=3600');
  res.json({
    vehicles: vehicles
      .filter((v) => stocked.has(String(v._id)))
      .map(({ slug, updatedAt }) => ({ slug, updatedAt })),
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
      const uploaded = await uploadToCloudinary(req.file.buffer, { folder: 'autobacs/vehicle and makes' });
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
      const uploaded = await uploadToCloudinary(req.file.buffer, { folder: 'autobacs/vehicle and makes' });
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
// @desc    Permanently delete a vehicle and strip it from every product's fitment
// @access  Private/Admin
//
// This used to be a soft delete (isActive = false), which made it a duplicate of
// PATCH /:id/toggle-status — there was no way to actually remove a vehicle, and
// the admin's "Delete" button silently just deactivated. Deactivation still
// lives on the toggle route; this one really deletes.
//
// Two-phase confirm: a delete for a vehicle that still has products mapped is
// rejected with 409 + the exact count, so the admin UI can name the number of
// products about to lose this fitment. Re-sending with `?force=true` commits.
//
// Ordering is the safety mechanism, deliberately instead of a transaction:
// products are cleaned FIRST, the vehicle row is dropped SECOND. A failure
// between the two leaves a vehicle with no products — harmless, and the delete
// can simply be retried ($pull is idempotent). The reverse order is the one
// that cannot be repaired from the UI: it would leave every product pointing at
// an id that no longer resolves, which is exactly the orphaned-ref state that
// broke vehicle fitment before.
router.delete("/:id", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const vehicle = await vehicleRepository.findById(req.params.id);

  if (!vehicle) {
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  }

  const force = req.query.force === 'true' || req.body?.force === true;

  // The count exists ONLY to populate the 409, so it is not run on a forced
  // delete: updateMany's own modifiedCount already answers the same question.
  // (Measured on prod-shaped data — 79 vehicles / 950 products — the count was
  // 63% of the forced path's query time and told us nothing new.)
  //
  // It deliberately counts inactive products too: the $pull writes to every
  // product regardless of publish state, so the number the admin confirms has
  // to be the number of documents actually touched.
  if (!force) {
    const productCount = await productRepository.countByCompatibleVehicle(vehicle._id);
    if (productCount > 0) {
      return res.status(409).json({
        success: false,
        requiresConfirmation: true,
        productCount,
        message: `${vehicle.make} ${vehicle.model} is mapped to ${productCount} product(s). Deleting removes this vehicle from their fitment.`
      });
    }
  }

  // Runs on BOTH paths — including the one where the count just said 0. That
  // count is a read taken before the delete, so a product can be mapped to this
  // vehicle in the window between the two; skipping the $pull there would
  // strand a ref to a row that no longer exists, and no admin screen can clear
  // a fitment whose vehicle is gone. $pull is idempotent, and the no-op case is
  // a single indexed updateMany.
  const { modifiedCount = 0 } = await productRepository.pullCompatibleVehicle(vehicle._id);

  await vehicleRepository.deleteById(vehicle._id);

  // Best effort from here on: the vehicle is gone, and neither a stranded
  // Cloudinary asset nor a missed purge justifies failing a completed delete.
  if (vehicle.image?.public_id) {
    try {
      await deleteFromCloudinary(vehicle.image.public_id);
    } catch (err) {
      console.warn(`[vehicles] Cloudinary cleanup failed for ${vehicle.image.public_id}:`, err.message);
    }
  }

  // 'products' as well as 'vehicles': the $pull changed product documents, so
  // any cached product payload carrying this fitment is now stale.
  invalidatePublicCache('vehicles', 'products');

  await auditLogger.logAction(req, 'VEHICLE_DELETE', 'Vehicle', vehicle._id, {
    make: vehicle.make,
    model: vehicle.model,
    slug: vehicle.slug,
    productsUnmapped: modifiedCount,
  });

  res.json({
    success: true,
    message: `${vehicle.make} ${vehicle.model} deleted permanently`,
    productsUnmapped: modifiedCount
  });
}));

// @route   GET /vehicles/admin/list
// @desc    Lean vehicle list for admin pickers (product create/edit fitment)
// @access  Private/Admin
//
// Why this exists instead of reusing the public GET /vehicles: that route runs
// through httpCache('VEHICLE_LIST'), which emits `public, max-age=1800`. Cookies
// are NOT part of the browser HTTP cache key, so an admin's authenticated fetch
// of /vehicles is served straight from their own disk cache — for up to 30
// minutes — using the copy the public storefront put there. The server-side
// "authenticated requests bypass the cache" guard never gets a chance to run,
// so a vehicle added a minute ago simply isn't in the picker.
//
// This route is not wrapped in httpCache at all, so it stores nothing in Redis —
// but "no Cache-Control header" is not the same as "not cached": a bare 200 is
// heuristically cacheable, which is precisely the ambiguity that produced the
// bug above. The no-store directive is therefore set EXPLICITLY below rather
// than left to the absence of a header.
//
// Also unlike /admin/all, this does NOT compute a per-vehicle product count —
// that route fires one countDocuments per row (N+1), which is pure waste when
// all the picker renders is a checkbox label.
router.get("/admin/list", protect, admin, asyncHandler(async (_req, res) => {
  const ADMIN_LIST_CAP = 500;

  const vehicles = await vehicleRepository
    .find({})
    .select('make model slug isActive')
    // Active first, THEN alphabetical. The cap below is a hard cut, and the
    // picker's whole job is choosing among active vehicles — ordering active
    // rows ahead of deactivated ones means an overflow can only ever cost the
    // rows the picker hides anyway, never a selectable vehicle.
    .sort({ isActive: -1, make: 1, model: 1 })
    .limit(ADMIN_LIST_CAP)
    .lean();

  const truncated = vehicles.length === ADMIN_LIST_CAP;
  if (truncated) {
    // Loud, because the client-side banner depends on an admin reading it and
    // the failure it precedes — a product silently missing a fitment option —
    // is invisible from the storefront.
    console.warn(`[vehicles] /admin/list hit the ${ADMIN_LIST_CAP}-row cap; the fitment picker is incomplete.`);
  }

  // Never cacheable. Set explicitly, not by omission.
  res.setHeader('Cache-Control', PRIVATE_NO_STORE);

  res.json({
    success: true,
    count: vehicles.length,
    // Read by the admin fitment pickers, which render a warning rather than
    // letting a truncated list look like the complete one.
    truncated,
    vehicles
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