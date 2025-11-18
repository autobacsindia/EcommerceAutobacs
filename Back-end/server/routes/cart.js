import express from "express";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// @route   GET /cart
// @desc    Get user's cart
// @access  Private
router.get("/", protect, asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user.id })
    .populate('items.product', 'name price images stock isActive');

  if (!cart) {
    cart = await Cart.create({ user: req.user.id, items: [] });
  }

  // Filter out inactive products
  cart.items = cart.items.filter(item => item.product && item.product.isActive);
  await cart.save();

  res.json({
    success: true,
    cart
  });
}));

// @route   POST /cart/add
// @desc    Add item to cart
// @access  Private
router.post("/add", protect, asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;

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

  // Check stock availability
  if (product.stock < quantity) {
    return res.status(400).json({
      success: false,
      message: `Only ${product.stock} items available in stock`
    });
  }

  let cart = await Cart.findOne({ user: req.user.id });

  if (!cart) {
    cart = new Cart({ user: req.user.id, items: [] });
  }

  // Check if product already in cart
  const existingItemIndex = cart.items.findIndex(
    item => item.product.toString() === productId
  );

  if (existingItemIndex > -1) {
    // Update quantity
    cart.items[existingItemIndex].quantity += Number(quantity);
    
    // Check stock again
    if (cart.items[existingItemIndex].quantity > product.stock) {
      return res.status(400).json({
        success: false,
        message: `Cannot add more. Only ${product.stock} items available in stock`
      });
    }
  } else {
    // Add new item
    cart.items.push({
      product: productId,
      quantity: Number(quantity),
      price: product.price
    });
  }

  await cart.save();
  await cart.populate('items.product', 'name price images stock isActive');

  res.json({
    success: true,
    message: 'Item added to cart',
    cart
  });
}));

// @route   PUT /cart/update/:productId
// @desc    Update cart item quantity
// @access  Private
router.put("/update/:productId", protect, asyncHandler(async (req, res) => {
  const { quantity } = req.body;

  if (!quantity || quantity < 1) {
    return res.status(400).json({
      success: false,
      message: 'Valid quantity is required'
    });
  }

  const cart = await Cart.findOne({ user: req.user.id });

  if (!cart) {
    return res.status(404).json({
      success: false,
      message: 'Cart not found'
    });
  }

  const itemIndex = cart.items.findIndex(
    item => item.product.toString() === req.params.productId
  );

  if (itemIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Item not found in cart'
    });
  }

  // Check stock
  const product = await Product.findById(req.params.productId);
  if (quantity > product.stock) {
    return res.status(400).json({
      success: false,
      message: `Only ${product.stock} items available in stock`
    });
  }

  cart.items[itemIndex].quantity = Number(quantity);
  cart.items[itemIndex].price = product.price; // Update price to current price
  
  await cart.save();
  await cart.populate('items.product', 'name price images stock isActive');

  res.json({
    success: true,
    message: 'Cart updated',
    cart
  });
}));

// @route   DELETE /cart/remove/:productId
// @desc    Remove item from cart
// @access  Private
router.delete("/remove/:productId", protect, asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id });

  if (!cart) {
    return res.status(404).json({
      success: false,
      message: 'Cart not found'
    });
  }

  cart.items = cart.items.filter(
    item => item.product.toString() !== req.params.productId
  );

  await cart.save();
  await cart.populate('items.product', 'name price images stock isActive');

  res.json({
    success: true,
    message: 'Item removed from cart',
    cart
  });
}));

// @route   DELETE /cart/clear
// @desc    Clear entire cart
// @access  Private
router.delete("/clear", protect, asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id });

  if (!cart) {
    return res.status(404).json({
      success: false,
      message: 'Cart not found'
    });
  }

  cart.items = [];
  await cart.save();

  res.json({
    success: true,
    message: 'Cart cleared',
    cart
  });
}));

export default router;
