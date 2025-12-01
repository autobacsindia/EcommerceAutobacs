import express from "express";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { body, validationResult } from "express-validator";

const router = express.Router();

// @route   GET /profile
// @desc    Get current user profile
// @access  Private
router.get("/", protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash');
  
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

// @route   PUT /profile
// @desc    Update user profile
// @access  Private
router.put("/", protect, [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('addresses.*.fullName').notEmpty().withMessage('Full name is required for address'),
  body('addresses.*.phone').notEmpty().withMessage('Phone is required for address'),
  body('addresses.*.addressLine1').notEmpty().withMessage('Address line 1 is required'),
  body('addresses.*.city').notEmpty().withMessage('City is required'),
  body('addresses.*.state').notEmpty().withMessage('State is required'),
  body('addresses.*.postalCode').notEmpty().withMessage('Postal code is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { name, email, addresses } = req.body;

  try {
    // Check if email is already taken by another user
    if (email !== req.user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser._id.toString() !== req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'Email is already taken'
        });
      }
    }

    // Update user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.name = name;
    user.email = email;
    
    // Update addresses if provided
    if (addresses) {
      user.addresses = addresses;
    }

    const updatedUser = await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        addresses: updatedUser.addresses
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error while updating profile'
    });
  }
}));

export default router;