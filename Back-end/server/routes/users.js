import express from "express";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { validateIdParam, validateUserUpdate } from "../middleware/validationMiddleware.js";
import auditLogger from "../services/auditLogger.js";
import { escapeRegex, phoneSearchPattern } from "../utils/identity.js";

const router = express.Router();

// @route   GET /users
// @desc    Get all users with pagination
// @access  Private/Admin
router.get("/", protect, admin, asyncHandler(async (req, res) => {
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 100;

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.search) {
    // Escape the raw term before it reaches $regex (injection / ReDoS guard).
    const search = String(req.query.search).trim();
    const safe = escapeRegex(search);
    const or = [
      { name: { $regex: safe, $options: 'i' } },
      { email: { $regex: safe, $options: 'i' } }
    ];
    // A phone-like query also matches the account phone and any address phone,
    // tolerant of separators/prefixes (+91, spaces, leading 0). `addresses` is
    // dropped from the projection below but can still be filtered on server-side.
    const phonePattern = phoneSearchPattern(search);
    if (phonePattern) {
      or.push({ phone: { $regex: phonePattern } });
      or.push({ 'addresses.phone': { $regex: phonePattern } });
    }
    filter.$or = or;
  }
  if (req.query.role) {
    filter.role = req.query.role;
  }

  // Exclude all sensitive / bulky fields from the list view
  const EXCLUDE = [
    '-passwordHash',
    '-resetPasswordToken',
    '-resetPasswordExpire',
    '-resetPasswordUsed',
    '-verificationToken',
    '-verificationTokenExpire',
    '-refreshTokens',
    '-loginAttempts',
    '-addresses',           // large nested array; not needed in admin list
    '-wallet.transactions'  // potentially large; balance alone is enough
  ].join(' ');

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(EXCLUDE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter)
  ]);

  res.json({
    success: true,
    count: users.length,
    users,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit
    }
  });
}));

// @route   GET /users/:id
// @desc    Get user by ID
// @access  Private/Admin
router.get("/:id", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-passwordHash');
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }
  
  res.json({
    success: true,
    user
  });
}));

// @route   PUT /users/:id
// @desc    Update user role/status
// @access  Private/Admin
router.put("/:id", protect, admin, validateUserUpdate, asyncHandler(async (req, res) => {
  const { name, email, role, isActive, isSalesRep, salesTarget } = req.body;

  const user = await User.findById(req.params.id);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Capture previous state for audit log
  const previousState = {
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    isSalesRep: user.isSalesRep,
    salesTarget: user.salesTarget
  };

  // Update user fields
  if (name) user.name = name;
  if (email) user.email = email.toLowerCase();
  if (role) user.role = role;
  if (typeof isActive !== 'undefined') user.isActive = isActive;
  // Sales CRM staffing (not session-sensitive — no version bump needed).
  if (typeof isSalesRep !== 'undefined') user.isSalesRep = isSalesRep;
  if (typeof salesTarget !== 'undefined') user.salesTarget = salesTarget;

  const updatedUser = await user.save();

  // CRITICAL: Atomic increment of session version on security-sensitive changes
  // This invalidates all existing sessions when email/role changes
  if (email || role) {
    await User.updateOne(
      { _id: user._id },
      { $inc: { sessionVersion: 1 } }
    );
    
    console.log(`[Users] Session version incremented for user ${user._id} (email/role changed)`);
  }

  // Log audit event
  auditLogger.logAction(
    req,
    'UPDATE',
    'User',
    user._id,
    {
      previous: previousState,
      updated: { name, email, role, isActive, isSalesRep, salesTarget }
    }
  );

  res.json({
    success: true,
    message: 'User updated successfully',
    user: {
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      isActive: updatedUser.isActive,
      isSalesRep: updatedUser.isSalesRep,
      salesTarget: updatedUser.salesTarget
    }
  });
}));

// @route   DELETE /users/:id
// @desc    Delete user
// @access  Private/Admin
router.delete("/:id", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }
  
  // Prevent deleting the current admin user
  if (user._id.toString() === req.user.id) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete your own account'
    });
  }

  const userEmail = user.email;
  const userId = user._id;
  
  await user.deleteOne();

  // Log audit event
  auditLogger.logAction(
    req,
    'DELETE',
    'User',
    userId,
    { email: userEmail }
  );
  
  res.json({
    success: true,
    message: 'User deleted successfully'
  });
}));

export default router;