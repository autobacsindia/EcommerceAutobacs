import express from "express";
import Review from "../models/Review.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { validateReview } from "../middleware/reviewValidationMiddleware.js";

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
router.get("/products/:productId", asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, sortBy = "createdAt", order = "desc", minRating, maxRating, hasImages } = req.query;
  const productId = req.params.productId;
  
  // Validate product ID
  if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid product ID"
    });
  }

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
    user: {
      id: review.user._id,
      name: review.user.name
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
router.get("/products/:productId/summary", asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  
  // Validate product ID
  if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid product ID"
    });
  }

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

// @route   POST /reviews/products/:productId
// @desc    Submit a new review for a product
// @access  Private (authenticated users)
router.post("/products/:productId", protect, validateReview, asyncHandler(async (req, res) => {
  const { rating, title, comment, images } = req.body;
  const productId = req.params.productId;
  const userId = req.user._id;

  // Validate product ID
  if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid product ID"
    });
  }

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

  // TODO: Check if user purchased this product (requires order integration)
  const isVerifiedPurchase = false;

  // Create review
  const review = new Review({
    product: productId,
    user: userId,
    rating,
    title,
    comment,
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
router.put("/:reviewId", protect, validateReview, asyncHandler(async (req, res) => {
  const { rating, title, comment, images } = req.body;
  const reviewId = req.params.reviewId;
  const userId = req.user._id;

  // Validate review ID
  if (!reviewId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid review ID"
    });
  }

  // Find review
  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found"
    });
  }

  // Check ownership
  if (review.user.toString() !== userId.toString()) {
    return res.status(403).json({
      success: false,
      message: "Not authorized to update this review"
    });
  }

  // Update review
  review.rating = rating;
  review.title = title;
  review.comment = comment;
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
router.delete("/:reviewId", protect, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;
  const userId = req.user._id;

  // Validate review ID
  if (!reviewId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid review ID"
    });
  }

  // Find review
  const review = await Review.findById(reviewId);
  if (!review) {
    return res.status(404).json({
      success: false,
      message: "Review not found"
    });
  }

  // Check ownership
  if (review.user.toString() !== userId.toString()) {
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
router.post("/:reviewId/helpful", protect, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;
  const userId = req.user._id;

  // Validate review ID
  if (!reviewId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid review ID"
    });
  }

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
router.get("/admin", protect, admin, asyncHandler(async (req, res) => {
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

// @route   PUT /reviews/:reviewId/approve
// @desc    Approve a review (admin)
// @access  Private/Admin
router.put("/:reviewId/approve", protect, admin, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;

  // Validate review ID
  if (!reviewId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid review ID"
    });
  }

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
router.put("/:reviewId/reject", protect, admin, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;

  // Validate review ID
  if (!reviewId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid review ID"
    });
  }

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
router.delete("/:reviewId/admin", protect, admin, asyncHandler(async (req, res) => {
  const reviewId = req.params.reviewId;

  // Validate review ID
  if (!reviewId.match(/^[0-9a-fA-F]{24}$/)) {
    return res.status(400).json({
      success: false,
      message: "Invalid review ID"
    });
  }

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