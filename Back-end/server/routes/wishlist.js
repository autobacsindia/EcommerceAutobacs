import express from "express";
import Wishlist from "../models/Wishlist.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// @route   GET /wishlist
// @desc    Get user's wishlist
// @access  Private
router.get("/", protect, asyncHandler(async (req, res) => {
  let wishlist = await Wishlist.findOne({ user: req.user.id })
    .populate('items.product', 'name price images stock isActive averageRating');

  if (!wishlist) {
    wishlist = await Wishlist.create({ user: req.user.id, items: [] });
  }

  // Filter out inactive products
  wishlist.items = wishlist.items.filter(item => item.product && item.product.isActive);
  await wishlist.save();

  res.json({
    success: true,
    count: wishlist.items.length,
    wishlist
  });
}));

// @route   POST /wishlist/add
// @desc    Add item to wishlist
// @access  Private
router.post("/add", protect, asyncHandler(async (req, res) => {
  const { productId } = req.body;

  if (!productId) {
    return res.status(400).json({
      success: false,
      message: 'Product ID is required'
    });
  }

  // Check if product exists and is active
  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    return res.status(404).json({
      success: false,
      message: 'Product not found or not available'
    });
  }

  let wishlist = await Wishlist.findOne({ user: req.user.id });

  if (!wishlist) {
    wishlist = new Wishlist({ user: req.user.id, items: [] });
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

  wishlist.items.push({ product: productId });
  await wishlist.save();
  await wishlist.populate('items.product', 'name price images stock isActive averageRating');

  res.json({
    success: true,
    message: 'Item added to wishlist',
    wishlist
  });
}));

// @route   DELETE /wishlist/remove/:productId
// @desc    Remove item from wishlist
// @access  Private
router.delete("/remove/:productId", protect, asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user.id });

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  wishlist.items = wishlist.items.filter(
    item => item.product.toString() !== req.params.productId
  );

  await wishlist.save();
  await wishlist.populate('items.product', 'name price images stock isActive averageRating');

  res.json({
    success: true,
    message: 'Item removed from wishlist',
    wishlist
  });
}));

// @route   DELETE /wishlist/clear
// @desc    Clear entire wishlist
// @access  Private
router.delete("/clear", protect, asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user.id });

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

// @route   POST /wishlist/move-to-cart/:productId
// @desc    Move item from wishlist to cart
// @access  Private
router.post("/move-to-cart/:productId", protect, asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user.id });

  if (!wishlist) {
    return res.status(404).json({
      success: false,
      message: 'Wishlist not found'
    });
  }

  const itemExists = wishlist.items.some(
    item => item.product.toString() === req.params.productId
  );

  if (!itemExists) {
    return res.status(404).json({
      success: false,
      message: 'Item not found in wishlist'
    });
  }

  // This would typically trigger the cart add logic
  // For now, just return success message
  res.json({
    success: true,
    message: 'Use POST /cart/add endpoint to add this item to cart',
    productId: req.params.productId
  });
}));

export default router;
