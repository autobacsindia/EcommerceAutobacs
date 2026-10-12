import express from "express";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { validateProfileUpdate } from "../middleware/validationMiddleware.js";
import { uploadSingle, handleMulterError } from "../middleware/uploadMiddleware.js";
import { putPublicAsset } from "../services/storage/publicUploads.js";
import { deleteHostedImages } from "../services/storage/publicImageDeletes.js";

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
router.put("/", protect, validateProfileUpdate, asyncHandler(async (req, res) => {
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
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}));

export default router;

// @route   POST /profile/avatar
// @desc    Upload or replace user avatar
// @access  Private
router.post(
  "/avatar",
  protect,
  uploadSingle('avatar'),
  handleMulterError,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    /*
      Upload FIRST, delete the old avatar only once the new one is stored. The
      reverse order leaves the user with no avatar at all whenever the upload
      fails — and their old one is already unrecoverable.
    */
    const old = user.avatar?.public_id
      ? { public_id: user.avatar.public_id, url: user.avatar.url }
      : null;

    const uploaded = await putPublicAsset(req.file.buffer, {
      folder: 'autobacs/users',
      contentType: req.file.mimetype,
    });

    user.avatar = { url: uploaded.secure_url, public_id: uploaded.public_id };
    await user.save();

    /*
      Deferred delete: the save commits FIRST, and only then is the old avatar
      removed. Deleting before the write means a failed save leaves the user
      with their old avatar destroyed and the new one unreferenced. Same order
      productImageController already uses for product imagery.

      Routed by the old ref's own url, so an avatar stored before the provider
      flip is deleted from the store that actually holds it.
    */
    if (old && old.public_id !== uploaded.public_id) {
      await deleteHostedImages([old]);
    }

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      avatar: user.avatar,
    });
  })
);

// @route   DELETE /profile/avatar
// @desc    Remove user avatar
// @access  Private
router.delete(
  "/avatar",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.avatar?.public_id) {
      await deleteHostedImages([{ public_id: user.avatar.public_id, url: user.avatar.url }]);
    }

    user.avatar = { url: '', public_id: '' };
    await user.save();

    res.json({ success: true, message: 'Avatar removed successfully' });
  })
);