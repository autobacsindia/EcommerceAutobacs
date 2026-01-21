import express from "express";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

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
router.get("/:id", protect, admin, asyncHandler(async (req, res) => {
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
router.put("/:id", protect, admin, asyncHandler(async (req, res) => {
  const { name, email, role, isActive } = req.body;
  
  const user = await User.findById(req.params.id);
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }
  
  // Update user fields
  if (name) user.name = name;
  if (email) user.email = email;
  if (role) user.role = role;
  if (isActive !== undefined) user.isActive = isActive;
  
  const updatedUser = await user.save();
  
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
router.delete("/:id", protect, admin, asyncHandler(async (req, res) => {
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
  
  await user.deleteOne();
  
  res.json({
    success: true,
    message: 'User deleted successfully'
  });
}));

export default router;