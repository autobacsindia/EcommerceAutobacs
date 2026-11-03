import express from "express";
import contactRepository from "../repositories/contactRepository.js";
import { protect, admin, optionalAuth } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { 
  validateContactSubmission, 
  validateContactStatusUpdate,
  validateContactQuery,
  validateIdParam
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

  const contact = await contactRepository.create(contactData);

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
  const contacts = await contactRepository.find(
    { user: req.user._id },
    { sort: { createdAt: -1 } }
  );

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
  try {
    const newCount = await contactRepository.count({ status: 'new' });
    
    res.json({
      success: true,
      data: {
        newCount
      }
    });
  } catch (error) {
    console.error('Error fetching contact stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contact statistics',
      error: error.message
    });
  }
}));

// @route   GET /contact
// @desc    Get all contact messages
// @access  Private/Admin
router.get("/", protect, admin, validateContactQuery, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (page - 1) * limit;

  const query = {};
  if (status) {
    query.status = status;
  }

  const contacts = await contactRepository.find(query, {
    sort: { createdAt: -1 },
    skip,
    limit: Number(limit),
  });

  const total = await contactRepository.count(query);

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
// @desc    Retired. Customer replies go out only through the support helpdesk
//          (services/supportEmailService.js), so there is one reply email with one
//          sender, one once-only guard and one thread. This route sent a second,
//          differently-branded "Response from Autobacs" email and no admin screen
//          calls it. 410 rather than 404 so a stale client learns why.
// @access  Private/Admin
router.post("/:id/reply", protect, admin, (req, res) => {
  res.status(410).json({
    success: false,
    message: "Replying here is no longer supported. Reply from the Support inbox instead."
  });
});

// @route   PUT /contact/:id
// @desc    Update contact message status
// @access  Private/Admin
router.put("/:id", protect, admin, validateIdParam, validateContactStatusUpdate, asyncHandler(async (req, res) => {
  const { status, adminNotes } = req.body;

  const contact = await contactRepository.findById(req.params.id);

  if (!contact) {
    return res.status(404).json({
      success: false,
      message: "Message not found"
    });
  }

  if (status) contact.status = status;
  if (adminNotes !== undefined) contact.adminNotes = adminNotes;

  await contactRepository.save(contact);

  res.json({
    success: true,
    data: contact
  });
}));

// @route   DELETE /contact/:id
// @desc    Delete a contact message
// @access  Private/Admin
router.delete("/:id", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const contact = await contactRepository.findById(req.params.id);

  if (!contact) {
    return res.status(404).json({
      success: false,
      message: "Message not found"
    });
  }

  await contactRepository.delete(req.params.id);

  res.json({
    success: true,
    message: "Message deleted"
  });
}));

export default router;
