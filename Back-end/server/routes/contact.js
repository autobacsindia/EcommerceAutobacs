import express from "express";
import Contact from "../models/Contact.js";
import { protect, admin, optionalAuth } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { check, validationResult } from "express-validator";

const router = express.Router();

// @route   POST /contact
// @desc    Submit a contact form message
// @access  Public
router.post("/", optionalAuth, [
  check('name', 'Name is required').not().isEmpty(),
  check('email', 'Please include a valid email').isEmail(),
  check('subject', 'Subject is required').not().isEmpty(),
  check('message', 'Message is required').not().isEmpty()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, email, subject, message } = req.body;

  const contactData = {
    name,
    email,
    subject,
    message
  };

  if (req.user) {
    contactData.user = req.user._id;
  }

  const contact = await Contact.create(contactData);

  res.status(201).json({
    success: true,
    message: "Thank you for contacting us. We will get back to you soon.",
    data: contact
  });
}));

// @route   GET /contact/me
// @desc    Get current user's messages
// @access  Private
router.get("/me", protect, asyncHandler(async (req, res) => {
  const contacts = await Contact.find({ user: req.user._id })
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    count: contacts.length,
    data: contacts
  });
}));

// @route   GET /contact
// @desc    Get all contact messages
// @access  Private/Admin
router.get("/", protect, admin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (page - 1) * limit;

  const query = {};
  if (status) {
    query.status = status;
  }

  const contacts = await Contact.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Contact.countDocuments(query);

  res.json({
    success: true,
    count: contacts.length,
    total,
    pages: Math.ceil(total / limit),
    page: Number(page),
    data: contacts
  });
}));

// @route   POST /contact/:id/reply
// @desc    Reply to a contact message
// @access  Private/Admin
router.post("/:id/reply", protect, admin, asyncHandler(async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({
      success: false,
      message: "Reply message is required"
    });
  }

  const contact = await Contact.findById(req.params.id);

  if (!contact) {
    return res.status(404).json({
      success: false,
      message: "Message not found"
    });
  }

  contact.reply = message;
  contact.repliedAt = Date.now();
  contact.status = 'replied';

  await contact.save();

  res.json({
    success: true,
    message: "Reply sent successfully",
    data: contact
  });
}));

// @route   PUT /contact/:id
// @desc    Update contact message status
// @access  Private/Admin
router.put("/:id", protect, admin, asyncHandler(async (req, res) => {
  const { status, adminNotes } = req.body;

  const contact = await Contact.findById(req.params.id);

  if (!contact) {
    return res.status(404).json({
      success: false,
      message: "Message not found"
    });
  }

  if (status) contact.status = status;
  if (adminNotes !== undefined) contact.adminNotes = adminNotes;

  await contact.save();

  res.json({
    success: true,
    data: contact
  });
}));

// @route   DELETE /contact/:id
// @desc    Delete a contact message
// @access  Private/Admin
router.delete("/:id", protect, admin, asyncHandler(async (req, res) => {
  const contact = await Contact.findById(req.params.id);

  if (!contact) {
    return res.status(404).json({
      success: false,
      message: "Message not found"
    });
  }

  await contact.deleteOne();

  res.json({
    success: true,
    message: "Message deleted"
  });
}));

export default router;
