import express from "express";
import Review from "../models/Review.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { 
  validateReviewSubmission, 
  validateReviewUpdate, 
  validateReviewIdParam,
  validateRouteProductId,
  validateAdminReviewQuery
} from "../middleware/validationMiddleware.js";
import { cleanHTML } from "../utils/htmlSanitizer.js";
import { reviewSubmitRateLimit } from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

// Helper function to calculate product rating stats
const updateProductRatingStats = async (productId) => {
  const reviews = await Review.find({ product: productId, isApproved: true });
  
  if (reviews.length === 0) {
    await Product.findByIdAndUpdate(productId, {
      averageRating: 0,
      totalReviews: 0
    });
    return;
  }

  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = totalRating / reviews.length;
  
  await Product.findByIdAndUpdate(productId, {
    averageRating: parseFloat(averageRating.toFixed(1)),
    totalReviews: reviews.length
  });
};

// @route   GET /reviews/products/:productId
// @desc    Get all approved reviews for a product with filtering and sorting
// @access  Public
router.get("/products/:productId", validateRouteProductId, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, sortBy = "createdAt", order = "desc", minRating, maxRating, hasImages } = req.query;
  const productId = req.params.productId;

  // Build filter
  const filter = { product: productId, isApproved: true };
  
  if (minRating) {
    filter.rating = { ...filter.rating, $gte: parseInt(minRating) };
  }
  
  if (maxRating) {
    filter.rating = { ...filter.rating, $lte: parseInt(maxRating) };
  }
  
  if (hasImages === "true") {
    filter["images.0"] = { $exists: true };
  }

  // Build sort
  const sort = {};
  sort[sortBy] = order === "asc" ? 1 : -1;

  // Execute query with pagination
  const reviews = await Review.find(filter)
    .populate("user", "name")
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  // Get total count for pagination
  const totalReviews = await Review.countDocuments(filter);

  // Format response
  const formattedReviews = reviews.map(review => ({
    id: review._id,
    // Imported (WooCommerce) and manual reviews have no linked user — fall back to guestName.
    user: {
      id: review.user?._id || null,
      name: review.user?.name || review.guestName || "Anonymous"
    },
    rating: review.rating,
    title: review.title,
    comment: review.comment,
    images: review.images,
    isVerifiedPurchase: review.isVerifiedPurchase,
    helpfulCount: review.helpfulCount,
    createdAt: review.createdAt
  }));

  res.json({
    success: true,
    count: formattedReviews.length,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalReviews / limit),
      totalReviews,
      hasNext: page * limit < totalReviews,
      hasPrev: page > 1
    },
    reviews: formattedReviews
  });
}));

// @route   GET /reviews/products/:productId/summary
// @desc    Get review summary for a product
// @access  Public
router.get("/products/:productId/summary", validateRouteProductId, asyncHandler(async (req, res) => {
  const productId = req.params.productId;

  // Get all approved reviews for this product
  const reviews = await Review.find({ product: productId, isApproved: true });

  if (reviews.length === 0) {
    return res.json({
      success: true,
      summary: {
        averageRating: 0,
        totalReviews: 0,
        ratingDistribution: {
          "5": 0,
          "4": 0,
          "3": 0,
          "2": 0,
          "1": 0
        }
      }
    });
  }

  // Calculate average rating
  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = totalRating / reviews.length;

  // Calculate rating distribution
  const ratingDistribution = {
    "5": 0,
    "4": 0,
    "3": 0,
    "2": 0,
    "1": 0
  };

  reviews.forEach(review => {
    ratingDistribution[review.rating.toString()]++;
  });

  res.json({
    success: true,
    summary: {
      averageRating: parseFloat(averageRating.toFixed(1)),
      totalReviews: reviews.length,
      ratingDistribution
    }
  });
}));

// @route   GET /reviews/testimonials
// @desc    Approved reviews flagged as testimonials, for the homepage (across all products)
// @access  Public
router.get("/testimonials", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 50);

  const reviews = await Review.find({ isTestimonial: true, isApproved: true })
    .populate("user", "name")
    .populate("product", "name slug images")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const testimonials = reviews.map(r => ({
    id: r._id,
    name: r.user?.name || r.guestName || "Anonymous",
    rating: r.rating,
    title: r.title,
    comment: r.comment,
    isVerifiedPurchase: r.isVerifiedPurchase,
    createdAt: r.createdAt,
    product: r.product ? {
      id: r.product._id,
      name: r.product.name,
      slug: r.product.slug,
      image: r.product.images?.[0]?.url || null
    } : null
  }));

  res.json({ success: true, count: testimonials.length, testimonials });
}));

// @route   GET /reviews/user
// @desc    Get all reviews submitted by the current user
// @access  Private
router.get("/user", protect, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, sortBy = "createdAt", order = "desc" } = req.query;
  const userId = req.user._id;

  // Build filter
  const filter = { user: userId };

  // Build sort
  const sort = {};
  sort[sortBy] = order === "asc" ? 1 : -1;

  // Execute query with pagination
  const reviews = await Review.find(filter)
    .populate("product", "name images")
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  // Get total count for pagination
  const totalReviews = await Review.countDocuments(filter);

  // Format response
  const formattedReviews = reviews.map(review => ({
    id: review._id,
    product: review.product ? {
      id: review.product._id,
      name: review.product.name,
      image: review.product.images && review.product.images.length > 0 ? review.product.images[0] : null
    } : null,
    rating: review.rating,
    title: review.title,
    comment: review.comment,
    images: review.images,
    isVerifiedPurchase: review.isVerifiedPurchase,
    isApproved: review.isApproved,
    helpfulCount: review.helpfulCount,
    createdAt: review.createdAt
  }));

  res.json({
    success: true,
    count: formattedReviews.length,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalReviews / limit),
      totalReviews,
      hasNext: page * limit < totalReviews,
      hasPrev: page > 1
    },
    reviews: formattedReviews
  });
}));

// @route   POST /reviews/products/:productId
// @desc    Submit a new review for a product
// @access  Private (authenticated users)
router.post("/products/:productId", protect, reviewSubmitRateLimit, validateReviewSubmission, asyncHandler(async (req, res) => {
  const { rating, title, comment, images } = req.body;
  const productId = req.params.productId;
  const userId = req.user._id;

  // Sanitize rich-text fields before storage
  const safeTitle   = cleanHTML(title);
  const safeComment = cleanHTML(comment);

  // Check if product exists
  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found"
    });
  }

  // Check if user already submitted a review for this product
  const existingReview = await Review.findOne({ product: productId, user: userId });
  if (existingReview) {
    return res.status(400).json({
      success: false,
      message: "You have already submitted a review for this product"
    });
  }

  const isVerifiedPurchase = !!(await Order.exists({
    user: userId,
    "items.product": productId,
    status: "delivered"
  }));

  // Create review
  const review = new Review({
    product: productId,
    user: userId,
    rating,
    title: safeTitle,
    comment: safeComment,
    images,
    isVerifiedPurchase,
    isApproved: false // Default to pending approval
  });

  const savedReview = await review.save();

  // Populate user info for response
  await savedReview.populate("user", "name");

  res.status(201).json({
    success: true,
    message: "Review submitted successfully and pending approval",
    review: {
      id: savedReview._id,
      rating: savedReview.rating,
      title: savedReview.title,
      comment: savedReview.comment,
      images: savedReview.images,
      isApproved: savedReview.isApproved,
      createdAt: savedReview.createdAt
    }
  });
}));

// @route   PUT /reviews/:reviewId
// @desc    Update own review
// @access  Private (review owner)
router.put("/:reviewId", protect, validateReviewUpdate, asyncHandler(async (req, res) => {
  const { rating, title, comment, images } = req.body;
  const reviewId = req.params.reviewId;
  const userId = req.user._id;

  // Sanitize rich-text fields before storage
  const safeTitle   = cleanHTML(title);
  const safeComment = cleanHTML(comment);

  // Find review
  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found"
    });
  }

  // Check ownership (imported/manual reviews have no owner and can't be edited by users)
  if (!review.user || review.user.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to update this review"
    });
  }

  // Update review
  review.rating = rating;
  review.title = safeTitle;
  review.comment = safeComment;
  review.images = images;
  // Reset approval status when updating
  review.isApproved = false;

  const updatedReview = await review.save();

  // Update product rating stats
  await updateProductRatingStats(review.product);

  res.json({
    success: true,
    message: "Review updated successfully",
    review: {
      id: updatedReview._id,
      rating: updatedReview.rating,
      title: updatedReview.title,
      comment: updatedReview.comment,
      isApproved: updatedReview.isApproved,
      updatedAt: updatedReview.updatedAt
    }
  });
}));

// @route   DELETE /reviews/:reviewId
// @desc    Delete own review
// @access  Private (review owner)
router.delete("/:reviewId", protect, validateReviewIdParam, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;
  const userId = req.user._id;

  // Find review
  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found"
    });
  }

  // Check ownership (imported/manual reviews have no owner and can't be edited by users)
  if (!review.user || review.user.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to delete this review"
    });
  }

  // Delete review
  await Review.findByIdAndDelete(reviewId);

  // Update product rating stats
  await updateProductRatingStats(review.product);

  res.json({
    success: true,
    message: "Review deleted successfully"
  });
}));

// @route   POST /reviews/:reviewId/helpful
// @desc    Mark a review as helpful
// @access  Private (authenticated users)
router.post("/:reviewId/helpful", protect, validateReviewIdParam, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;

  // Find review
  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found"
    });
  }

  // Increment helpful count
  review.helpfulCount += 1;
  const updatedReview = await review.save();

  res.json({
    success: true,
    message: "Review marked as helpful",
    helpfulCount: updatedReview.helpfulCount
  });
}));

// ADMIN ROUTES

// @route   GET /reviews/admin
// @desc    Get all reviews (admin) with filtering
// @access  Private/Admin
router.get("/admin", protect, admin, validateAdminReviewQuery, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, productId, userId, sortBy = "createdAt", order = "desc" } = req.query;
  
  // Build filter
  const filter = {};
  
  if (status === "approved") {
    filter.isApproved = true;
  } else if (status === "pending") {
    filter.isApproved = false;
  }
  
  if (productId) {
    filter.product = productId;
  }
  
  if (userId) {
    filter.user = userId;
  }

  // Build sort
  const sort = {};
  sort[sortBy] = order === "asc" ? 1 : -1;

  // Execute query with pagination
  const reviews = await Review.find(filter)
    .populate("user", "name email")
    .populate("product", "name")
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  // Get total count for pagination
  const totalReviews = await Review.countDocuments(filter);

  res.json({
    success: true,
    count: reviews.length,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalReviews / limit),
      totalReviews,
      hasNext: page * limit < totalReviews,
      hasPrev: page > 1
    },
    reviews
  });
}));

// @route   POST /reviews/admin
// @desc    Create a manual review (admin) — custom reviewer name, auto-approved.
//          Used for seeding reviews and testimonials. Renders identically to a real review.
// @access  Private/Admin
router.post("/admin", protect, admin, asyncHandler(async (req, res) => {
  const { productId, reviewerName, rating, title, comment, isVerifiedPurchase, isTestimonial, date } = req.body;

  const ratingNum = parseInt(rating, 10);
  if (!productId || !reviewerName?.trim() || !comment?.trim() || !(ratingNum >= 1 && ratingNum <= 5)) {
    return res.status(400).json({
      success: false,
      message: "productId, reviewerName, comment and rating (1-5) are required"
    });
  }

  const product = await Product.findById(productId).select("_id");
  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  const review = new Review({
    product: productId,
    guestName: reviewerName.trim(),
    rating: ratingNum,
    title: cleanHTML(title || ""),
    comment: cleanHTML(comment),
    isVerifiedPurchase: !!isVerifiedPurchase,
    isTestimonial: !!isTestimonial,
    isApproved: true // admin-authored → live immediately
  });
  await review.save();

  // Optional backdating so seeded reviews can blend into history.
  if (date && !Number.isNaN(Date.parse(date))) {
    await Review.collection.updateOne({ _id: review._id }, { $set: { createdAt: new Date(date) } });
  }

  await updateProductRatingStats(productId);

  res.status(201).json({
    success: true,
    message: "Review created",
    review: {
      id: review._id,
      name: review.guestName,
      rating: review.rating,
      title: review.title,
      comment: review.comment,
      isVerifiedPurchase: review.isVerifiedPurchase,
      isTestimonial: review.isTestimonial,
      isApproved: review.isApproved
    }
  });
}));

// @route   PUT /reviews/:reviewId/testimonial
// @desc    Toggle a review's testimonial flag (admin)
// @access  Private/Admin
router.put("/:reviewId/testimonial", protect, admin, validateReviewIdParam, asyncHandler(async (req, res) => {
  const review = await Review.findByIdAndUpdate(
    req.params.reviewId,
    { isTestimonial: !!req.body.isTestimonial },
    { new: true }
  );

  if (!review) {
    return res.status(404).json({ success: false, message: "Review not found" });
  }

  res.json({
    success: true,
    message: review.isTestimonial ? "Marked as testimonial" : "Removed from testimonials",
    review: { id: review._id, isTestimonial: review.isTestimonial }
  });
}));

// @route   PUT /reviews/:reviewId/approve
// @desc    Approve a review (admin)
// @access  Private/Admin
router.put("/:reviewId/approve", protect, admin, validateReviewIdParam, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;

  // Find and update review
  const review = await Review.findByIdAndUpdate(
    reviewId,
    { isApproved: true },
    { new: true }
  );

  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found"
    });
  }

  // Update product rating stats
  await updateProductRatingStats(review.product);

  res.json({
    success: true,
    message: "Review approved successfully",
    review: {
      id: review._id,
      isApproved: review.isApproved,
      updatedAt: review.updatedAt
    }
  });
}));

// @route   PUT /reviews/:reviewId/reject
// @desc    Reject a review (admin)
// @access  Private/Admin
router.put("/:reviewId/reject", protect, admin, validateReviewIdParam, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;

  // Find and update review
  const review = await Review.findByIdAndUpdate(
    reviewId,
    { isApproved: false },
    { new: true }
  );

  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found"
    });
  }

  // Update product rating stats
  await updateProductRatingStats(review.product);

  res.json({
    success: true,
    message: "Review rejected successfully",
    review: {
      id: review._id,
      isApproved: review.isApproved,
      updatedAt: review.updatedAt
    }
  });
}));

// @route   DELETE /reviews/:reviewId/admin
// @desc    Delete any review (admin)
// @access  Private/Admin
router.delete("/:reviewId/admin", protect, admin, validateReviewIdParam, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;

  // Find review
  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found"
    });
  }

  // Store product ID for updating stats
  const productId = review.product;

  // Delete review
  await Review.findByIdAndDelete(reviewId);

  // Update product rating stats
  await updateProductRatingStats(productId);

  res.json({
    success: true,
    message: "Review deleted successfully"
  });
}));

export default router;