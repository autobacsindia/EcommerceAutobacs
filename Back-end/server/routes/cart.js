import express from "express";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { validateCartItem, validateCartUpdate, validateCartProductIdParam } from "../middleware/validationMiddleware.js";

const router = express.Router();

// @route   GET /cart
// @desc    Get user's cart (supports both authenticated and guest users)
// @access  Public (optional auth)
router.get("/", asyncHandler(async (req, res) => {
  try {
    // Determine if user is authenticated or guest
    const isAuthenticated = req.user && req.user.id;
    const sessionId = req.headers['x-session-id'] || req.sessionID;

    let cart;
    if (isAuthenticated) {
      // Authenticated user - find by user ID
      cart = await Cart.findOne({ user: req.user.id })
        .populate('items.product', 'name price images stock isActive');
      
      if (!cart) {
        cart = await Cart.create({ user: req.user.id, items: [], isGuest: false });
      }
    } else {
      // Guest user - find by session ID
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID required for guest cart operations'
        });
      }
      
      cart = await Cart.findOne({ sessionId })
        .populate('items.product', 'name price images stock isActive');
      
      if (!cart) {
        cart = await Cart.create({ sessionId, items: [], isGuest: true });
      }
    }

    console.log('[Cart] Retrieved cart for', isAuthenticated ? `user ${req.user.id}` : `session ${sessionId}`, 'with', cart.items.length, 'items');

  // 🟡 LAYER 1: Cart-Level Stock Validation
  // Filter out inactive AND out-of-stock products
  const originalItemsCount = cart.items.length;
  const removedItems = [];
  const adjustedItems = [];

  cart.items = cart.items.filter(item => {
    if (!item.product || !item.product.isActive) {
      removedItems.push({
        productId: item.product._id,
        productName: item.product.name,
        previousQuantity: item.quantity
      });
      return false;
    }
    if (item.product.stock <= 0) {
      removedItems.push({
        productId: item.product._id,
        productName: item.product.name,
        previousQuantity: item.quantity
      });
      return false;
    }
    return true;
  });

  // Auto-adjust quantities that exceed available stock
  let adjustedCount = 0;
  cart.items.forEach(item => {
    if (item.quantity > item.product.stock) {
      adjustedItems.push({
        productId: item.product._id,
        productName: item.product.name,
        previousQuantity: item.quantity,
        newQuantity: item.product.stock
      });
      item.quantity = item.product.stock;
      adjustedCount++;
    }
  });

  // Log changes for transparency
  const changesToLog = [];
  
  if (removedItems.length > 0) {
    changesToLog.push(...removedItems.map(item => ({
      type: 'REMOVED_OUT_OF_STOCK',
      productId: item.productId,
      productName: item.productName,
      previousQuantity: item.previousQuantity,
      newQuantity: 0,
      message: `${item.productName} was removed because it's now out of stock`
    })));
  }
  
  if (adjustedItems.length > 0) {
    changesToLog.push(...adjustedItems.map(item => ({
      type: 'QUANTITY_ADJUSTED',
      productId: item.productId,
      productName: item.productName,
      previousQuantity: item.previousQuantity,
      newQuantity: item.newQuantity,
      message: `${item.productName} quantity adjusted from ${item.previousQuantity} to ${item.newQuantity} based on availability`
    })));
  }

  // Save changes if items were removed or adjusted
  if (originalItemsCount !== cart.items.length || adjustedCount > 0) {
    if (changesToLog.length > 0) {
      cart.recentChanges.push(...changesToLog);
      // Keep only last 10 changes to prevent bloat
      if (cart.recentChanges.length > 10) {
        cart.recentChanges = cart.recentChanges.slice(-10);
      }
    }
    await cart.save();
  }

  // Build stock validation messages
  const stockMessages = [];
  if (originalItemsCount !== cart.items.length) {
    stockMessages.push(`${originalItemsCount - cart.items.length} item(s) removed - out of stock`);
  }
  if (adjustedCount > 0) {
    stockMessages.push(`${adjustedCount} item(s) quantity adjusted based on availability`);
  }

  res.json({
    success: true,
    cart,
    stockMessages: stockMessages.length > 0 ? stockMessages : undefined,
    recentChanges: cart.recentChanges.filter(c => c.createdAt > Date.now() - 300000) // Last 5 min
  });
}));

// @route   POST /cart/add
// @desc    Add item to cart
// @access  Private
router.post("/add", validateCartItem, asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;

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

  // Determine if user is authenticated or guest
  const isAuthenticated = req.user && req.user.id;
  const sessionId = req.headers['x-session-id'] || req.sessionID;

  // Find cart by user ID or session ID
  let cart;
  if (isAuthenticated) {
    // Authenticated user - find by user ID
    cart = await Cart.findOne({ user: req.user.id })
      .populate('items.product', 'name price images stock isActive');
    
    if (!cart) {
      cart = new Cart({ user: req.user.id, items: [], isGuest: false });
    }
  } else {
    // Guest user - find by session ID
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required for guest cart operations'
      });
    }
    
    cart = await Cart.findOne({ sessionId })
      .populate('items.product', 'name price images stock isActive');
    
    if (!cart) {
      cart = new Cart({ sessionId, items: [], isGuest: true });
    }
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
// @access  Public (optional auth)
router.put("/update/:productId", validateCartUpdate, asyncHandler(async (req, res) => {
  const { quantity } = req.body;

  // Determine if user is authenticated or guest
  const isAuthenticated = req.user && req.user.id;
  const sessionId = req.headers['x-session-id'] || req.sessionID;

  // Find cart by user ID or session ID
  let cart;
  if (isAuthenticated) {
    cart = await Cart.findOne({ user: req.user.id });
  } else {
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required for guest cart operations'
      });
    }
    cart = await Cart.findOne({ sessionId });
  }

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

  // 🟡 LAYER 1: Stock Validation on Quantity Update
  const product = await Product.findById(req.params.productId);
  
  // Check if product is out of stock
  if (product.stock <= 0) {
    return res.status(400).json({
      success: false,
      message: `This item is now out of stock`
    });
  }
  
  // Check if requested quantity exceeds available stock
  if (quantity > product.stock) {
    return res.status(400).json({
      success: false,
      message: `Only ${product.stock} items available in stock`,
      maxQuantity: product.stock
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
// @access  Public (optional auth)
router.delete("/remove/:productId", validateCartProductIdParam, asyncHandler(async (req, res) => {
  // Determine if user is authenticated or guest
  const isAuthenticated = req.user && req.user.id;
  const sessionId = req.headers['x-session-id'] || req.sessionID;

  // Find cart by user ID or session ID
  let cart;
  if (isAuthenticated) {
    cart = await Cart.findOne({ user: req.user.id });
  } else {
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required for guest cart operations'
      });
    }
    cart = await Cart.findOne({ sessionId });
  }

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
// @access  Public (optional auth)
router.delete("/clear", asyncHandler(async (req, res) => {
  // Determine if user is authenticated or guest
  const isAuthenticated = req.user && req.user.id;
  const sessionId = req.headers['x-session-id'] || req.sessionID;

  // Find cart by user ID or session ID
  let cart;
  if (isAuthenticated) {
    cart = await Cart.findOne({ user: req.user.id });
  } else {
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required for guest cart operations'
      });
    }
    cart = await Cart.findOne({ sessionId });
  }

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

// @route   POST /cart/validate-checkout
// @desc    🟠 LAYER 2: Pre-checkout stock validation (blocking check)
// @access  Public (optional auth)
router.post("/validate-checkout", asyncHandler(async (req, res) => {
  // Determine if user is authenticated or guest
  const isAuthenticated = req.user && req.user.id;
  const sessionId = req.headers['x-session-id'] || req.sessionID;

  // Find cart
  let cart;
  if (isAuthenticated) {
    cart = await Cart.findOne({ user: req.user.id })
      .populate('items.product', 'name price images stock isActive');
  } else {
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required for guest cart operations'
      });
    }
    
    cart = await Cart.findOne({ sessionId })
      .populate('items.product', 'name price images stock isActive');
  }

  if (!cart || cart.items.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Your cart is empty'
    });
  }

  // 🟠 LAYER 2: Pre-Checkout Validation - Validate ALL items
  const validationErrors = [];
  const validItems = [];

  for (const item of cart.items) {
    if (!item.product || !item.product.isActive) {
      validationErrors.push({
        productId: item.product?._id || item.product,
        message: 'Product no longer available',
        type: 'unavailable'
      });
      continue;
    }

    if (item.product.stock <= 0) {
      validationErrors.push({
        productId: item.product._id,
        name: item.product.name,
        message: 'This item is out of stock',
        type: 'out_of_stock'
      });
      continue;
    }

    if (item.quantity > item.product.stock) {
      validationErrors.push({
        productId: item.product._id,
        name: item.product.name,
        message: `Only ${item.product.stock} left in stock`,
        availableStock: item.product.stock,
        requestedQuantity: item.quantity,
        type: 'insufficient_stock'
      });
      continue;
    }

    // Item is valid
    validItems.push(item);
  }

  const isValid = validationErrors.length === 0;

  res.json({
    success: isValid,
    isValid,
    validationErrors: isValid ? [] : validationErrors,
    validItemsCount: validItems.length,
    totalItems: cart.items.length,
    message: isValid 
      ? 'All items are available and ready for checkout'
      : `${validationErrors.length} item(s) have stock issues`
  });
}));

export default router;
