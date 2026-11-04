import express from "express";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { uploadSingle, handleMulterError, validateUploadedFiles } from "../middleware/uploadMiddleware.js";
import { putPublicAsset } from "../services/storage/publicUploads.js";
import { deleteHostedImages } from "../services/storage/publicImageDeletes.js";
import { AddressBookError, normaliseAddressBook, normalisePhone } from "../utils/addressBook.js";
import { normaliseProfileUpdate, phoneVariants, ProfileUpdateError } from "../utils/profileUpdate.js";
import { STAFF_TEAM_LABELS } from "../config/staff.js";

const router = express.Router();

// What the profile page reads back after a save — no tokens, wallet history or login trail.
const OWN_PROFILE_FIELDS = 'name email phone role staff.team staff.isHead avatar addresses profile isVerified';

/** The signed-in person's own profile, as the "My profile" page shows it. */
const ownProfileOf = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone || '',
  role: u.role,
  // Read-only on the page: set by an admin in the team panel, never here.
  teamLabel: u.role === 'staff' ? STAFF_TEAM_LABELS[u.staff?.team] ?? null : u.role === 'admin' ? 'Admin' : null,
  avatar: { url: u.avatar?.url || '' },
  addresses: u.addresses ?? [],
  profile: {
    jobTitle: u.profile?.jobTitle || '',
    dateOfBirth: u.profile?.dateOfBirth ? u.profile.dateOfBirth.toISOString().slice(0, 10) : '',
    emergencyContact: { name: u.profile?.emergencyContact?.name || '', phone: u.profile?.emergencyContact?.phone || '' },
    bio: u.profile?.bio || '',
  },
});

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
    user,
    // The "My profile" form's shape (dates as YYYY-MM-DD, team as a label).
    me: ownProfileOf(user),
  });
}));

// @route   GET /profile/addresses
// @desc    The signed-in customer's saved delivery addresses (lean read for checkout)
// @access  Private
router.get("/addresses", protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select("addresses").lean();
  if (!user) return res.status(404).json({ success: false, message: "User not found" });
  res.json({ success: true, addresses: user.addresses ?? [] });
}));

// @route   PUT /profile/addresses
// @desc    Replace the saved address list. Touches NOTHING else on the user —
//          see utils/addressBook.js for why this is not PUT /profile.
// @access  Private
router.put("/addresses", protect, asyncHandler(async (req, res) => {
  let addresses;
  try {
    addresses = normaliseAddressBook(req.body?.addresses);
  } catch (err) {
    // Answered here, not thrown: the error middleware replaces messages it has
    // not whitelisted with a generic one, and "PIN code must be 6 digits" is
    // exactly the sentence the customer needs to see.
    if (err instanceof AddressBookError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    throw err;
  }
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  user.addresses = addresses;
  await user.save();
  res.json({ success: true, addresses: user.addresses });
}));

// @route   PUT /profile
// @desc    Update my own profile. Allow-listed in utils/profileUpdate.js: role,
//          team, email, sessionVersion and every other key are ignored even if
//          sent. Keyed on req.user.id only — there is no :id, so nobody can
//          address another person's profile through this route.
// @access  Private
router.put("/", protect, asyncHandler(async (req, res) => {
  let update;
  try {
    update = normaliseProfileUpdate(req.body, req.user);
  } catch (err) {
    // Answered here: the error middleware genericises messages it has not
    // whitelisted, and "Phone must be a 10-digit mobile number" is the point.
    if (err instanceof ProfileUpdateError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    throw err;
  }

  /*
    Guest checkout finds an account by its phone, so a number already on another
    REGISTERED account must not be claimable here — otherwise that person's
    phone-only orders could land in this account. Checked only when the number
    actually changes (re-saving your own number never trips it), and guest
    records left by past checkouts don't count: they are usually this same
    person, from before they signed up.
  */
  if (update.phone && update.phone !== normalisePhone(req.user.phone)) {
    const taken = await User.exists({
      _id: { $ne: req.user.id },
      isGuest: { $ne: true },
      phone: { $in: phoneVariants(update.phone) },
    });
    if (taken) {
      return res.status(409).json({
        success: false,
        message: 'This mobile number is already linked to another registered account. If it is yours, please contact support.',
      });
    }
  }

  const ops = {};
  if (Object.keys(update.set).length) ops.$set = update.set;
  if (Object.keys(update.unset).length) ops.$unset = update.unset;
  const user = await User.findByIdAndUpdate(req.user.id, ops, { new: true, runValidators: true })
    .select(OWN_PROFILE_FIELDS);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  res.json({ success: true, message: 'Profile updated successfully', user: ownProfileOf(user) });
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
  // Magic bytes + pixel dimensions: the file really is the JPG/PNG/WebP it claims.
  validateUploadedFiles,
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