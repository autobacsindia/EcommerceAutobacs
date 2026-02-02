import express from "express";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { check, param, validationResult } from "express-validator";
import auditLogger from "../services/auditLogger.js";

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// @route   GET /users
// @desc    Get all users
// @access  Private/Admin
router.get("/", protect, admin, asyncHandler(async (req, res) => {
  const users = await User.find({}).select('-passwordHash').sort({ createdAt: -1 });
  
  res.json({
    success: true,
    count: users.length,
    users
  });
}));

// @route   GET /users/:id
// @desc    Get user by ID
// @access  Private/Admin
router.get("/:id", protect, admin, [
  param('id', 'Invalid user ID').isMongoId(),
  validate
], asyncHandler(async (req, res) => {
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
router.put("/:id", protect, admin, [
  param('id', 'Invalid user ID').isMongoId(),
  check('name', 'Name is required').optional().notEmpty(),
  check('email', 'Valid email is required').optional().isEmail(),
  check('role', 'Invalid role').optional().isIn(['user', 'admin']),
  check('isActive', 'isActive must be a boolean').optional().isBoolean(),
  validate
], asyncHandler(async (req, res) => {
  const { name, email, role, isActive } = req.body;
  
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
    isActive: user.isActive
  };
  
  // Update user fields
  if (name) user.name = name;
  if (email) user.email = email;
  if (role) user.role = role;
  if (isActive !== undefined) user.isActive = isActive;
  
  const updatedUser = await user.save();

  // Log audit event
  auditLogger.logAction(
    req,
    'UPDATE',
    'User',
    user._id,
    {
      previous: previousState,
      updated: { name, email, role, isActive }
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
      isActive: updatedUser.isActive
    }
  });
}));

// @route   DELETE /users/:id
// @desc    Delete user
// @access  Private/Admin
router.delete("/:id", protect, admin, [
  param('id', 'Invalid user ID').isMongoId(),
  validate
], asyncHandler(async (req, res) => {
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