import React, { useState, useEffect } from 'react';
import ReviewSummary from './ReviewSummary';
import ReviewForm from './ReviewForm';
import ReviewList from './ReviewList';
import { 
  getReviewSummary, 
  getReviews, 
  submitReview, 
  markReviewAsHelpful,
  ReviewSummary as ReviewSummaryType,
  Review,
  PaginatedReviews
} from '../../lib/services/reviewService';
import styles from './Reviews.module.css';

interface ReviewsProps {
  productId: string;
  isAuthenticated: boolean;
}

const Reviews: React.FC<ReviewsProps> = ({ productId, isAuthenticated }) => {
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryType | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [totalReviews, setTotalReviews] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Fetch review summary and initial reviews
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [summary, reviewsData] = await Promise.all([
          getReviewSummary(productId),
          getReviews(productId)
        ]);
        
        setReviewSummary(summary);
        setReviews(reviewsData.reviews);
        setTotalReviews(reviewsData.pagination.totalReviews);
      } catch (err) {
        setError('Failed to load reviews data');
        console.error('Error fetching reviews:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [productId]);

  const handleReviewSubmit = async (reviewData: any) => {
    try {
      const result = await submitReview(productId, reviewData);
      if (result.success) {
        // Hide form after successful submission
        setShowForm(false);
        // In a real app, we would refetch the reviews and summary
        alert(result.message);
      }
    } catch (err) {
      console.error('Error submitting review:', err);
      alert('Failed to submit review. Please try again.');
    }
  };

  const handleHelpful = async (reviewId: string) => {
    try {
      const result = await markReviewAsHelpful(reviewId);
      if (result.success) {
        // Update the helpful count in the UI
        setReviews(prevReviews => 
          prevReviews.map(review => 
            review.id === reviewId 
              ? { ...review, helpfulCount: result.helpfulCount } 
              : review
          )
        );
      }
    } catch (err) {
      console.error('Error marking review as helpful:', err);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading reviews...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  return (
    <div className={styles.reviewsSection}>
      <h2>Customer Reviews</h2>
      
      {reviewSummary && (
        <ReviewSummary 
          averageRating={reviewSummary.averageRating}
          totalReviews={reviewSummary.totalReviews}
          ratingDistribution={reviewSummary.ratingDistribution}
        />
      )}

      {isAuthenticated && (
        <div className={styles.reviewActions}>
          {!showForm ? (
            <button 
              onClick={() => setShowForm(true)}
              className={styles.writeReviewBtn}
            >
              Write a Review
            </button>
          ) : (
            <ReviewForm 
              productId={productId}
              onSubmit={handleReviewSubmit}
              onCancel={() => setShowForm(false)}
            />
          )}
        </div>
      )}

      {reviews.length > 0 && (
        <ReviewList 
          reviews={reviews}
          onHelpful={handleHelpful}
          totalReviews={totalReviews}
        />
      )}

      {reviews.length === 0 && !showForm && (
        <div className={styles.noReviews}>
          <p>No reviews yet. Be the first to review this product!</p>
          {isAuthenticated && (
            <button 
              onClick={() => setShowForm(true)}
              className={styles.writeReviewBtn}
            >
              Write a Review
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default Reviews;