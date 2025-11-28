// Review validation middleware

export const validateReview = (req, res, next) => {
  const { rating, title, comment, images } = req.body;
  const errors = [];

  // Rating validation
  if (rating === undefined || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    errors.push('Rating must be an integer between 1 and 5');
  }

  // Comment validation
  if (!comment || comment.trim().length < 10) {
    errors.push('Review comment must be at least 10 characters long');
  }

  if (comment && comment.length > 1000) {
    errors.push('Review comment must be less than 1000 characters');
  }

  // Title validation (optional)
  if (title && title.length > 100) {
    errors.push('Review title must be less than 100 characters');
  }

  // Images validation (optional)
  if (images) {
    if (!Array.isArray(images)) {
      errors.push('Images must be an array');
    } else if (images.length > 5) {
      errors.push('Maximum 5 images allowed per review');
    } else {
      for (const image of images) {
        if (!image.url) {
          errors.push('Each image must have a URL');
        }
        // Basic URL validation
        try {
          new URL(image.url);
        } catch (e) {
          errors.push('Invalid image URL format');
        }
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
};