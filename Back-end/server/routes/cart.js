import express from "express";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import pricingService, { effectivePrice, resolveVariant } from "../services/pricingService.js";
import { validateCartItem, validateCartUpdate, validateCartProductIdParam } from "../middleware/validationMiddleware.js";
import { STOCK_STATUS, isPurchasable } from "../utils/stockStatus.js";

// Resolve the buyable unit for an add/update: a simple product prices from itself;
// a variable product prices from its SELECTED variant (which carries its own price
// + stock). Returns { price, variantId, variantLabel } or throws a {status,message}.
// Centralised so add-to-cart and the pricing service stay consistent.
function resolvePurchasable(product, rawVariantId) {
  if (product.productType === 'variable') {
    // Shared resolution (find / exists / stock) lives in pricingService.resolveVariant
    // so add-to-cart and the checkout recompute never diverge.
    const { variant, reason } = resolveVariant(product, rawVariantId);
    if (reason === 'unselected') throw { status: 400, message: 'Please select a variant before adding to cart' };
    if (reason === 'missing') throw { status: 400, message: 'Selected variant is no longer available' };
    if (reason) {
      throw {
        status: 400,
        message: reason === 'backorder'
          ? 'This model is on backorder — please enquire to order it'
          : 'This model is out of stock'
      };
    }
    return { price: effectivePrice(variant), variantId: variant._id, variantLabel: variant.label };
  }
  if (!isPurchasable(product.stock)) {
    throw {
      status: 400,
      message: product.stock === STOCK_STATUS.BACKORDER
        ? 'This item is on backorder — please enquire to order it'
        : 'This item is out of stock'
    };
  }
  return { price: effectivePrice(product), variantId: null, variantLabel: null };
}

// Two cart lines are the SAME only if product AND variant match (null==null for simple).
const sameLine = (item, productId, variantId) =>
  (item.product._id || item.product).toString() === String(productId) &&
  String(item.variantId || '') === String(variantId || '');

// Is a POPULATED cart line still buyable? Variant-aware: a variable line requires
// its selected variant to still exist AND be purchasable; a simple line uses the
// product's own stock. Used to prune the cart on read (GET /cart).
function linePurchasable(item) {
  const product = item.product;
  if (!product || !product.isActive) return false;
  if (product.productType === 'variable') {
    const variant = (product.variants || []).find(v => String(v._id) === String(item.variantId || ''));
    return !!variant && isPurchasable(variant.stock);
  }
  return isPurchasable(product.stock);
}

// Re-price a POPULATED cart line against current DB state (variant-aware). Returns
// the current unit price + display name, and flags stock/variant problems for the
// validate endpoints. Requires item.product to have `variants` populated for
// variable products.
function repriceLine(item) {
  const product = item.product;
  const displayName = (label) => label ? `${product.name} — ${label}` : product.name;
  if (product.productType === 'variable') {
    const variant = (product.variants || []).find(v => String(v._id) === String(item.variantId || ''));
    if (!variant) {
      return { ok: false, type: 'unavailable', message: 'Selected variant no longer available',
               unitPrice: item.price, name: displayName(item.variantLabel) };
    }
    const name = displayName(variant.label);
    if (!isPurchasable(variant.stock)) {
      return { ok: false, type: 'out_of_stock', message: 'Out of stock', unitPrice: effectivePrice(variant), name };
    }
    return { ok: true, unitPrice: effectivePrice(variant), name };
  }
  if (product.stock === STOCK_STATUS.OUT) {
    return { ok: false, type: 'out_of_stock', message: 'Out of stock', unitPrice: effectivePrice(product), name: product.name };
  }
  return { ok: true, unitPrice: effectivePrice(product), name: product.name };
}

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
        .populate('items.product', 'name price images stock isActive productType variants');
      
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
        .populate('items.product', 'name price images stock isActive productType variants');
      
      if (!cart) {
        cart = await Cart.create({ sessionId, items: [], isGuest: true });
      }
    }

    console.log('[Cart] Retrieved cart for', isAuthenticated ? `user ${req.user.id}` : `session ${sessionId}`, 'with', cart.items.length, 'items');

  // 🟡 LAYER 1: Cart-Level Stock Validation
  // Stock is a coarse status, so we only drop items that are inactive or
  // explicitly out of stock. There is no quantity cap to auto-adjust against.
  const originalItemsCount = cart.items.length;
  const removedItems = [];

  cart.items = cart.items.filter(item => {
    // Drop items that became inactive or non-purchasable. Variant-aware: a
    // variable line is dropped when its selected variant is gone or out of
    // stock/backorder, even if a sibling variant keeps the parent "in stock".
    if (!linePurchasable(item)) {
      if (item.product) {
        removedItems.push({
          productId: item.product._id,
          productName: item.variantLabel ? `${item.product.name} — ${item.variantLabel}` : item.product.name,
          previousQuantity: item.quantity
        });
      }
      return false;
    }
    return true;
  });

  // Log changes for transparency
  const changesToLog = removedItems.map(item => ({
    type: 'REMOVED_OUT_OF_STOCK',
    productId: item.productId,
    productName: item.productName,
    previousQuantity: item.previousQuantity,
    newQuantity: 0,
    message: `${item.productName} was removed because it's now out of stock`
  }));

  // Save changes if items were removed
  if (originalItemsCount !== cart.items.length) {
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

  res.json({
    success: true,
    cart,
    stockMessages: stockMessages.length > 0 ? stockMessages : undefined,
    recentChanges: cart.recentChanges.filter(c => c.createdAt > Date.now() - 300000) // Last 5 min
  });
  } catch (error) {
    console.error('[Cart] Error in GET /cart:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while retrieving cart'
    });
  }
}));

// @route   POST /cart/add
// @desc    Add item to cart
// @access  Private
router.post("/add", validateCartItem, asyncHandler(async (req, res) => {
  const { productId, variantId = null, quantity = 1 } = req.body;

  // Check if product exists and is active
  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    return res.status(404).json({
      success: false,
      message: 'Product not found or not available'
    });
  }

  // Resolve the buyable unit + its price/stock. For variable products this
  // requires (and validates) the selected variant; out-of-stock / backorder /
  // missing-selection all surface a buyer-facing 400 here.
  let resolved;
  try {
    resolved = resolvePurchasable(product, variantId);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  // Determine if user is authenticated or guest
  const isAuthenticated = req.user && req.user.id;
  const sessionId = req.headers['x-session-id'] || req.sessionID;

  // Find cart by user ID or session ID
  let cart;
  if (isAuthenticated) {
    // Authenticated user - find by user ID
    cart = await Cart.findOne({ user: req.user.id })
      .populate('items.product', 'name price images stock isActive productType variants');
    
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
      .populate('items.product', 'name price images stock isActive productType variants');
    
    if (!cart) {
      cart = new Cart({ sessionId, items: [], isGuest: true });
    }
  }

  // Same product + same variant = same line (a variable product added for two
  // different models becomes two distinct lines). After populate(), item.product
  // is a document — sameLine handles both populated and raw forms.
  const existingItemIndex = cart.items.findIndex(
    item => sameLine(item, productId, resolved.variantId)
  );

  if (existingItemIndex > -1) {
    // Update quantity (no per-unit stock cap under status-based availability)
    cart.items[existingItemIndex].quantity += Number(quantity);
  } else {
    // Add new item (price is the resolved unit price — variant price for variable)
    cart.items.push({
      product: productId,
      variantId: resolved.variantId,
      variantLabel: resolved.variantLabel,
      quantity: Number(quantity),
      price: resolved.price
    });
  }

  await cart.save();
  await cart.populate('items.product', 'name price images stock isActive productType variants');

  res.json({
    success: true,
    message: 'Item added to cart',
    cart
  });
}));

// @route   POST /cart/merge
// @desc    Merge a guest (session) cart into the authenticated user's cart.
//          Called once right after login/register/social so items added while
//          logged out survive authentication. Ordered merge → save → delete so a
//          mid-flight failure never drops the guest items (they stay claimable);
//          a sequential retry finds the guest cart already consumed, so it won't
//          double-count.
// @access  Private (optionalAuth runs at router level; we require req.user here)
router.post("/merge", asyncHandler(async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required to merge cart'
    });
  }

  const sessionId = req.headers['x-session-id'] || req.sessionID;

  const guestCart = sessionId
    ? await Cart.findOne({ sessionId })
    : null;

  let userCart = await Cart.findOne({ user: req.user.id });
  if (!userCart) {
    userCart = new Cart({ user: req.user.id, items: [], isGuest: false });
  }

  if (guestCart && guestCart.items.length > 0) {
    for (const guestItem of guestCart.items) {
      const productId = (guestItem.product._id || guestItem.product).toString();
      // Union by product + variant: the same product under two models stays two lines.
      const existing = userCart.items.find(
        item => sameLine(item, productId, guestItem.variantId)
      );
      if (existing) {
        // Union: sum quantities so re-adding a product the user already had accumulates.
        existing.quantity += guestItem.quantity;
      } else {
        userCart.items.push({
          product: guestItem.product,
          variantId: guestItem.variantId || null,
          variantLabel: guestItem.variantLabel || null,
          quantity: guestItem.quantity,
          price: guestItem.price
        });
      }
    }
  }

  // Carry a guest-applied coupon across login, but never clobber one the user already
  // has. It is only a code — the merged cart is re-quoted, and a coupon the guest could
  // hold but this user cannot (firstOrderOnly, per-user cap) simply errors at quote time.
  if (guestCart?.couponCode && !userCart.couponCode) {
    userCart.couponCode = guestCart.couponCode;
  }

  await userCart.save();

  // Consume the guest cart only after the merged user cart is safely persisted.
  if (guestCart) {
    await Cart.deleteOne({ _id: guestCart._id });
  }

  await userCart.populate('items.product', 'name price images stock isActive productType variants');

  res.json({
    success: true,
    message: 'Cart merged',
    cart: userCart
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

  // Target the exact line: product + variant (variantId optional in the body for
  // variable products; simple products send none).
  const variantId = req.body.variantId || null;
  const itemIndex = cart.items.findIndex(
    item => sameLine(item, req.params.productId, variantId)
  );

  if (itemIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Item not found in cart'
    });
  }

  // 🟡 LAYER 1: Stock Validation on Quantity Update
  const product = await Product.findById(req.params.productId);
  if (!product || !product.isActive) {
    return res.status(404).json({ success: false, message: 'Product not found or not available' });
  }

  // Re-resolve the buyable unit (variant-aware): blocks updates for items that are
  // no longer purchasable and re-prices from the current variant/product price.
  let resolved;
  try {
    resolved = resolvePurchasable(product, variantId);
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }

  cart.items[itemIndex].quantity = Number(quantity);
  cart.items[itemIndex].price = resolved.price; // Update price to current (variant) price

  await cart.save();
  await cart.populate('items.product', 'name price images stock isActive productType variants');

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

  // Remove the exact line. variantId (query) disambiguates when the same product
  // sits in the cart under multiple variants; omitting it removes the simple line
  // (variantId null). If no variantId is given for a product that only exists as a
  // single line, that line still matches.
  const variantId = req.query.variantId || null;
  cart.items = cart.items.filter(
    item => !sameLine(item, req.params.productId, variantId)
  );

  await cart.save();
  await cart.populate('items.product', 'name price images stock isActive productType variants');

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
  cart.couponCode = null;
  await cart.save();

  res.json({
    success: true,
    message: 'Cart cleared',
    cart
  });
}));

/**
 * Resolve the caller's cart (authenticated user or guest session), or null.
 */
async function findCallerCart(req) {
  if (req.user && req.user.id) return Cart.findOne({ user: req.user.id });
  const sessionId = req.headers['x-session-id'] || req.sessionID;
  if (!sessionId) return null;
  return Cart.findOne({ sessionId });
}

// @route   PUT /cart/coupon
// @desc    Validate a coupon against the current cart and remember it on the cart.
//          Stores the CODE only — never a discount amount. The authoritative maths is
//          re-run by pricingService at quote time and again at order creation, so a code
//          persisted here can never by itself change what the buyer is charged.
// @access  Public (optional auth)
router.put("/coupon", asyncHandler(async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ success: false, message: 'Coupon code is required' });
  }

  const cart = await findCallerCart(req);
  if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });
  if (!cart.items.length) {
    return res.status(400).json({ success: false, message: 'Add items to your cart before applying a coupon' });
  }

  // Guests have no identity, so coupons gated on firstOrderOnly / usageLimitPerUser
  // are rejected here with REASON.LOGIN rather than appearing to apply and then
  // failing at order creation.
  const quote = await pricingService.computeQuote({
    items: cart.items.map((i) => ({ product: i.product, quantity: i.quantity })),
    couponCode: code,
    userId: req.user?.id || null
  });

  if (quote.couponError) {
    return res.status(400).json({ success: false, message: quote.couponError });
  }

  cart.couponCode = code;
  await cart.save();

  res.json({ success: true, message: `${code} applied`, cart, quote });
}));

// @route   DELETE /cart/coupon
// @desc    Remove the coupon remembered on the cart.
// @access  Public (optional auth)
router.delete("/coupon", asyncHandler(async (req, res) => {
  const cart = await findCallerCart(req);
  if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

  cart.couponCode = null;
  await cart.save();

  res.json({ success: true, message: 'Coupon removed', cart });
}));

// @route   GET /cart/validate
// @desc    Re-price every cart item against current DB prices and return server-calculated totals.
//          Call this immediately before order creation. The response total is the only
//          authoritative amount the frontend should display or submit.
// @access  Public (optional auth)
router.get("/validate", asyncHandler(async (req, res) => {
  const isAuthenticated = req.user && req.user.id;
  const sessionId = req.headers['x-session-id'] || req.sessionID;

  let cart;
  if (isAuthenticated) {
    cart = await Cart.findOne({ user: req.user.id })
      .populate('items.product', 'name price stock isActive productType variants');
  } else {
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID required for guest cart operations' });
    }
    cart = await Cart.findOne({ sessionId })
      .populate('items.product', 'name price stock isActive productType variants');
  }

  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ success: false, message: 'Your cart is empty' });
  }

  const stockErrors = [];
  const validatedItems = [];

  for (const item of cart.items) {
    if (!item.product || !item.product.isActive) {
      stockErrors.push({ productId: item.product?._id, message: 'Product no longer available', type: 'unavailable' });
      continue;
    }
    // For variable products the price + stock come from the selected variant.
    const line = repriceLine(item);
    if (!line.ok) {
      stockErrors.push({ productId: item.product._id, name: item.product.name, message: line.message, type: line.type });
      if (line.type !== 'out_of_stock') continue; // unresolved variant → skip repricing
    }
    // Always use the current DB price (variant-aware), never the stale cart-stored price.
    validatedItems.push({
      productId: item.product._id,
      variantId: item.variantId || null,
      name: line.name,
      quantity: item.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.unitPrice * item.quantity
    });
  }

  const subtotal = validatedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  // Product prices are GST-inclusive ("Inclusive of all taxes").
  // Extract the embedded GST for display purposes only — total stays unchanged.
  const tax   = Math.round((subtotal - subtotal / 1.18) * 100) / 100;
  const total = Math.round(subtotal * 100) / 100;

  res.json({
    success: true,
    isValid: stockErrors.length === 0,
    stockErrors,
    items: validatedItems,
    subtotal,
    tax,
    total,
    taxRate: 0.18
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
      .populate('items.product', 'name price images stock isActive productType variants');
  } else {
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID required for guest cart operations'
      });
    }
    
    cart = await Cart.findOne({ sessionId })
      .populate('items.product', 'name price images stock isActive productType variants');
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

    // Variant-aware stock check: for variable products the selected variant must
    // still exist and be purchasable.
    const line = repriceLine(item);
    if (!line.ok) {
      validationErrors.push({
        productId: item.product._id,
        name: line.name,
        message: line.type === 'unavailable' ? 'Selected model no longer available' : 'This item is out of stock',
        type: line.type
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
