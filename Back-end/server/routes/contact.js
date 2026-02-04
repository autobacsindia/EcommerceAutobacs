import express from "express";
import Contact from "../models/Contact.js";
import emailHandler from "../services/emailHandler.js";
import { protect, admin, optionalAuth } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { 
  validateContactSubmission, 
  validateContactReply, 
  validateContactStatusUpdate 
} from "../middleware/validationMiddleware.js";

const router = express.Router();

// @route   POST /contact
// @desc    Submit a contact form message
// @access  Public
router.post("/", optionalAuth, validateContactSubmission, asyncHandler(async (req, res) => {
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

// @route   GET /contact/stats
// @desc    Get contact message statistics (e.g. unread count)
// @access  Private/Admin
router.get("/stats", protect, admin, asyncHandler(async (req, res) => {
  const newCount = await Contact.countDocuments({ status: 'new' });
  
  res.json({
    success: true,
    data: {
      newCount
    }
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
router.post("/:id/reply", protect, admin, validateContactReply, asyncHandler(async (req, res) => {
  const { message } = req.body;

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

  // Send email notification
  try {
    await emailHandler.sendEmail({
      to: contact.email,
      subject: `Re: ${contact.subject} - Response from Autobacs`,
      text: `Dear ${contact.name},\n\n${message}\n\nBest regards,\nAutobacs Team`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <p>Dear ${contact.name},</p>
          <p>Thank you for contacting Autobacs. Here is our response to your inquiry:</p>
          <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #d01f2f; margin: 20px 0;">
            <p style="white-space: pre-wrap; margin: 0;">${message}</p>
          </div>
          <p>Original Message:<br/>
          <em style="color: #666;">"${contact.message}"</em></p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <p>Best regards,<br/><strong>Autobacs Team</strong></p>
        </div>
      `
    });
  } catch (emailError) {
    console.error('Failed to send reply email:', emailError);
    // Continue execution, don't fail the request
  }

  res.json({
    success: true,
    message: "Reply sent successfully",
    data: contact
  });
}));

// @route   PUT /contact/:id
// @desc    Update contact message status
// @access  Private/Admin
router.put("/:id", protect, admin, validateContactStatusUpdate, asyncHandler(async (req, res) => {
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
router.delete("/:id", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
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
