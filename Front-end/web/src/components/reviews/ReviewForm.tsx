import React, { useState } from 'react';
import StarRating from './StarRating';
import styles from './ReviewForm.module.css';

interface ReviewFormProps {
  productId: string;
  onSubmit: (reviewData: ReviewFormData) => Promise<void>;
  onCancel?: () => void;
}

interface ReviewFormData {
  rating: number;
  title: string;
  comment: string;
  images: { url: string; alt: string }[];
}

const ReviewForm: React.FC<ReviewFormProps> = ({ productId, onSubmit, onCancel }) => {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [images, setImages] = useState<{ url: string; alt: string }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (rating < 1 || rating > 5) {
      newErrors.rating = 'Please select a rating';
    }

    if (!comment.trim()) {
      newErrors.comment = 'Comment is required';
    } else if (comment.trim().length < 10) {
      newErrors.comment = 'Comment must be at least 10 characters';
    } else if (comment.trim().length > 1000) {
      newErrors.comment = 'Comment must be less than 1000 characters';
    }

    if (title && title.length > 100) {
      newErrors.title = 'Title must be less than 100 characters';
    }

    if (images.length > 5) {
      newErrors.images = 'Maximum 5 images allowed';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({ rating, title, comment, images });
      // Reset form on successful submission
      setRating(0);
      setTitle('');
      setComment('');
      setImages([]);
    } catch (error) {
      console.error('Error submitting review:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImageAdd = (url: string, alt: string) => {
    if (images.length < 5) {
      setImages([...images, { url, alt }]);
    }
  };

  const handleImageRemove = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  return (
    <div className={styles.reviewFormContainer}>
      <h3>Write a Review</h3>
      <form onSubmit={handleSubmit} className={styles.reviewForm}>
        <div className={styles.formGroup}>
          <label htmlFor="rating">Rating *</label>
          <StarRating 
            rating={rating} 
            interactive={true} 
            onRatingChange={setRating}
            size="large"
          />
          {errors.rating && <span className={styles.error}>{errors.rating}</span>}
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="title">Title</label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summarize your review (optional)"
            className={errors.title ? styles.errorInput : ''}
          />
          {errors.title && <span className={styles.error}>{errors.title}</span>}
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="comment">Comment *</label>
          <textarea
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Share your experience with this product"
            rows={5}
            className={errors.comment ? styles.errorInput : ''}
          />
          <div className={styles.characterCount}>
            {comment.length}/1000
          </div>
          {errors.comment && <span className={styles.error}>{errors.comment}</span>}
        </div>

        {/* Image upload section - simplified for now */}
        <div className={styles.formGroup}>
          <label htmlFor="images">Images (optional)</label>
          <div className={styles.imageUploadSection}>
            {images.map((image, index) => (
              <div key={index} className={styles.imagePreview}>
                <img src={image.url} alt={image.alt || 'Review image'} />
                <button 
                  type="button" 
                  onClick={() => handleImageRemove(index)}
                  className={styles.removeImageBtn}
                >
                  ×
                </button>
              </div>
            ))}
            {images.length < 5 && (
              <div className={styles.imageUploadPlaceholder}>
                <p>Image upload functionality would be implemented here</p>
                <p className={styles.imageLimit}>Max 5 images</p>
              </div>
            )}
          </div>
          {errors.images && <span className={styles.error}>{errors.images}</span>}
        </div>

        <div className={styles.formActions}>
          <button 
            type="submit" 
            disabled={isSubmitting}
            className={styles.submitBtn}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </button>
          {onCancel && (
            <button 
              type="button" 
              onClick={onCancel}
              className={styles.cancelBtn}
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default ReviewForm;