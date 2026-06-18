import express from "express";
import wishlistRepository from "../repositories/wishlistRepository.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { validateWishlist, validateWishlistItem, validateSharing, validateIdParam, validateWishlistImport, validateRouteProductId, validateUserIdParam } from "../middleware/validationMiddleware.js";
import crypto from "crypto";

const router = express.Router();

// @route   GET /wishlist
// @desc    Get all user's wishlists
// @access  Private
router.get("/", protect, asyncHandler(async (req, res) => {
  const wishlists = await wishlistRepository.find({ user: req.user.id })
    .populate('items.product', 'name price images stock isActive averageRating')
    .select('-shareToken');

  res.json({
    success: true,
    count: wishlists.length,
    wishlists
  });
}));

// @route   GET /wishlist/:id
// @desc    Get specific wishlist
// @access  Private/Public (with token)
router.get("/:id", function(req, res, next) {
  // If there's a token, skip authentication
  if (req.query.token) {
    return next();
  }
  // Otherwise, require authentication
  protect(req, res, next);
}, validateIdParam, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;

  let wishlist;
  
  if (token) {
    // Access via share token
    wishlist = await wishlistRepository.findOne({ _id: id, shareToken: token })
      .populate('items.product', 'name price images stock isActive averageRating')
      .populate('user', 'name');
  } else {
    // Access via authentication
    // Check if user is authenticated (this should always be true due to protect middleware)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    wishlist = await wishlistRepository.findOne({ _id: id, user: req.user.id })
      .populate('items.product', 'name price images stock isActive averageRating')
      .populate('user', 'name');
  }

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  // Filter out inactive products
  wishlist.items = wishlist.items.filter(item => item.product && item.product.isActive);

  res.json({
    success: true,
    wishlist
  });
}));

// @route   POST /wishlist
// @desc    Create new wishlist
// @access  Private
router.post("/", protect, validateWishlist, asyncHandler(async (req, res) => {
  const { name, description, privacy } = req.body;

  // Check if wishlist with this name already exists for user
  const existingWishlist = await wishlistRepository.findOne({ user: req.user.id, name });
  if (existingWishlist) {
    return res.status(409).json({
      success: false,
      message: 'Wishlist with this name already exists'
    });
  }

  // Create new wishlist
  const wishlistData = {
    user: req.user.id,
    name,
    description,
    privacy: privacy || 'private'
  };

  // Generate share token for public wishlists
  if (privacy === 'public') {
    wishlistData.shareToken = crypto.randomBytes(32).toString('hex');
  }

  const wishlist = await wishlistRepository.create(wishlistData);

  res.status(201).json({
    success: true,
    wishlist
  });
}));

// @route   PUT /wishlist/:id
// @desc    Update wishlist details
// @access  Private
router.put("/:id", protect, validateIdParam, validateWishlist, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, privacy } = req.body;

  // Find wishlist
  let wishlist = await wishlistRepository.findOne({ _id: id, user: req.user.id });
  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  // Check if another wishlist with this name already exists
  if (name && name !== wishlist.name) {
    const existingWishlist = await wishlistRepository.findOne({ 
      user: req.user.id, 
      name,
      _id: { $ne: id }
    });
    
    if (existingWishlist) {
      return res.status(409).json({
        success: false,
        message: 'Wishlist with this name already exists'
      });
    }
  }

  // Update fields
  if (name) wishlist.name = name;
  if (description !== undefined) wishlist.description = description;
  if (privacy) {
    wishlist.privacy = privacy;
    // Generate share token for public wishlists
    if (privacy === 'public' && !wishlist.shareToken) {
      wishlist.shareToken = crypto.randomBytes(32).toString('hex');
    }
    // Remove share token for private wishlists
    if (privacy === 'private') {
      wishlist.shareToken = undefined;
    }
  }

  await wishlist.save();

  // Populate and return updated wishlist
  wishlist = await wishlist.populate('items.product', 'name price images stock isActive averageRating');

  res.json({
    success: true,
    wishlist
  });
}));

// @route   DELETE /wishlist/:id
// @desc    Delete wishlist
// @access  Private
router.delete("/:id", protect, validateIdParam, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const wishlist = await wishlistRepository.findOneAndDelete({ _id: id, user: req.user.id });

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  res.json({
    success: true,
    message: 'Wishlist deleted successfully'
  });
}));

// @route   POST /wishlist/:id/items
// @desc    Add item to wishlist
// @access  Private
router.post("/:id/items", protect, validateIdParam, validateWishlistItem, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { productId, notes } = req.body;
  
  // Check if product exists and is active
  const product = await Product.findById(productId);
  
  if (!product || !product.isActive) {
    return res.status(404).json({
      success: false,
      message: 'Product not found or not available'
    });
  }

  // Find wishlist
  const wishlist = await wishlistRepository.findOne({ _id: id, user: req.user.id });
  
  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  // Check if product already in wishlist
  const existingItem = wishlist.items.find(
    item => item.product.toString() === productId
  );
  
  if (existingItem) {
    return res.status(400).json({
      success: false,
      message: 'Product already in wishlist'
    });
  }

  // Add item to wishlist
  wishlist.items.push({ 
    product: productId,
    notes: notes || undefined
  });
  
  await wishlist.save();
  await wishlist.populate('items.product', 'name price images stock isActive averageRating');
    
  res.json({
    success: true,
    message: 'Item added to wishlist',
    wishlist
  });
}));

// @route   DELETE /wishlist/:id/items/:productId
// @desc    Remove item from wishlist
// @access  Private
router.delete("/:id/items/:productId", protect, validateIdParam, validateRouteProductId, asyncHandler(async (req, res) => {
  const { id, productId } = req.params;

  const wishlist = await wishlistRepository.findOne({ _id: id, user: req.user.id });

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  wishlist.items = wishlist.items.filter(
    item => item.product.toString() !== productId
  );

  await wishlist.save();
  await wishlist.populate('items.product', 'name price images stock isActive averageRating');

  res.json({
    success: true,
    message: 'Item removed from wishlist',
    wishlist
  });
}));

// @route   DELETE /wishlist/:id/clear
// @desc    Clear entire wishlist
// @access  Private
router.delete("/:id/clear", protect, validateIdParam, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const wishlist = await wishlistRepository.findOne({ _id: id, user: req.user.id });

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  wishlist.items = [];
  await wishlist.save();

  res.json({
    success: true,
    message: 'Wishlist cleared',
    wishlist
  });
}));

// @route   POST /wishlist/:id/share
// @desc    Share wishlist with users or generate share link
// @access  Private
router.post("/:id/share", protect, validateIdParam, validateSharing, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userIds, role, isPublic } = req.body;

  const wishlist = await wishlistRepository.findOne({ _id: id, user: req.user.id });

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  if (isPublic) {
    // Make wishlist public
    wishlist.privacy = 'public';
    if (!wishlist.shareToken) {
      wishlist.shareToken = crypto.randomBytes(32).toString('hex');
    }
  } else if (userIds && userIds.length > 0) {
    // Share with specific users
    wishlist.privacy = 'shared';
    
    // Add users to sharedWith array
    for (const userId of userIds) {
      // Check if user is already shared with
      const existingShare = wishlist.sharedWith.find(
        share => share.userId.toString() === userId
      );
      
      if (!existingShare) {
        wishlist.sharedWith.push({
          userId,
          role: role || 'viewer'
        });
      }
    }
  }

  await wishlist.save();

  res.json({
    success: true,
    message: isPublic ? 'Wishlist is now public' : 'Wishlist shared with users',
    shareLink: wishlist.shareToken ? `${req.protocol}://${req.get('host')}/api/wishlist/${wishlist._id}?token=${wishlist.shareToken}` : null,
    wishlist
  });
}));

// @route   DELETE /wishlist/:id/share/:userId
// @desc    Revoke user access to shared wishlist
// @access  Private
router.delete("/:id/share/:userId", protect, validateIdParam, validateUserIdParam, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;

  const wishlist = await wishlistRepository.findOne({ _id: id, user: req.user.id });

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  // Remove user from sharedWith array
  wishlist.sharedWith = wishlist.sharedWith.filter(
    share => share.userId.toString() !== userId
  );

  await wishlist.save();

  res.json({
    success: true,
    message: 'User access revoked',
    wishlist
  });
}));

// @route   GET /wishlist/:id/export
// @desc    Export wishlist as JSON
// @access  Private
router.get("/:id/export", protect, validateIdParam, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const wishlist = await wishlistRepository.findOne({ _id: id, user: req.user.id })
    .populate('items.product', 'name price images stock isActive averageRating');

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  // Prepare export data
  const exportData = {
    wishlist: {
      name: wishlist.name,
      description: wishlist.description,
      privacy: wishlist.privacy,
      items: wishlist.items.map(item => ({
        productId: item.product._id,
        productName: item.product.name,
        notes: item.notes,
        addedAt: item.addedAt
      })),
      createdAt: wishlist.createdAt,
      updatedAt: wishlist.updatedAt
    }
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${wishlist.name.replace(/\s+/g, '_')}_wishlist.json"`);

  res.json(exportData);
}));

// @route   POST /wishlist/import
// @desc    Import wishlist from JSON
// @access  Private
router.post("/import", protect, validateWishlistImport, asyncHandler(async (req, res) => {
  const { wishlistData } = req.body;

  if (!wishlistData || !wishlistData.name) {
    return res.status(400).json({
      success: false,
      message: 'Invalid wishlist data'
    });
  }

  // Check if wishlist with this name already exists
  const existingWishlist = await wishlistRepository.findOne({ 
    user: req.user.id, 
    name: wishlistData.name 
  });
  
  if (existingWishlist) {
    return res.status(409).json({
      success: false,
      message: 'Wishlist with this name already exists'
    });
  }

  // Process items
  const items = [];
  if (wishlistData.items && Array.isArray(wishlistData.items)) {
    for (const item of wishlistData.items) {
      // Verify product exists
      const product = await Product.findById(item.productId);
      if (product && product.isActive) {
        items.push({
          product: item.productId,
          notes: item.notes,
          addedAt: item.addedAt || new Date()
        });
      }
    }
  }

  // Create new wishlist
  const wishlist = await wishlistRepository.create({
    user: req.user.id,
    name: wishlistData.name,
    description: wishlistData.description,
    privacy: wishlistData.privacy || 'private',
    items
  });

  await wishlist.populate('items.product', 'name price images stock isActive averageRating');

  res.status(201).json({
    success: true,
    message: 'Wishlist imported successfully',
    wishlist
  });
}));

export default router;