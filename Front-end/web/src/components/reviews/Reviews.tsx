'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { PenLine } from 'lucide-react';
import ReviewSummary from './ReviewSummary';
import ReviewForm from './ReviewForm';
import ReviewList from './ReviewList';
import {
  getReviewSummary,
  getReviews,
  submitReview,
  markReviewAsHelpful,
} from '../../lib/services/reviewService';
import { ReviewSummary as ReviewSummaryType, Review } from '../../lib/types';

interface ReviewsProps {
  productId: string;
  isAuthenticated: boolean;
}

const Reviews: React.FC<ReviewsProps> = ({ productId, isAuthenticated }) => {
  const router = useRouter();
  const pathname = usePathname();
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryType | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [totalReviews, setTotalReviews] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [summary, reviewsData] = await Promise.all([
          getReviewSummary(productId),
          getReviews(productId),
        ]);

        setReviewSummary(summary);
        setReviews(reviewsData.reviews);
        setTotalReviews(reviewsData.pagination.totalReviews || 0);
      } catch (err) {
        setError('Failed to load reviews data');
        console.error('Error fetching reviews:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [productId]);

  // Show the CTA to everyone; logged-out users are sent to login and returned
  // to this product's review section afterwards.
  const handleWriteReviewClick = () => {
    if (isAuthenticated) {
      setShowForm(true);
    } else {
      const returnUrl = `${pathname}#reviews`;
      router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
    }
  };

  const handleReviewSubmit = async (reviewData: any) => {
    try {
      const result = await submitReview(productId, reviewData);
      if (result.success) {
        setShowForm(false);
        // New reviews are held for moderation (isApproved: false), so they won't
        // appear in the list yet — surface the backend's "pending approval" note.
        toast.success(result.message || 'Review submitted — pending approval.');
      }
    } catch (err: any) {
      console.error('Error submitting review:', err);
      toast.error(err.message || 'Failed to submit review. Please try again.');
    }
  };

  const handleHelpful = async (reviewId: string) => {
    try {
      const result = await markReviewAsHelpful(reviewId);
      if (result.success) {
        setReviews((prev) =>
          prev.map((review) =>
            review.id === reviewId ? { ...review, helpfulCount: result.helpfulCount } : review
          )
        );
      }
    } catch (err) {
      console.error('Error marking review as helpful:', err);
    }
  };

  if (loading) {
    return <div className="py-6 text-sm text-ink-muted">Loading reviews…</div>;
  }

  if (error) {
    return <div className="py-6 text-sm text-red-400">{error}</div>;
  }

  return (
    <div className="space-y-8">
      {reviewSummary && (
        <ReviewSummary
          averageRating={reviewSummary.averageRating}
          totalReviews={reviewSummary.totalReviews}
          ratingDistribution={reviewSummary.ratingDistribution}
        />
      )}

      {showForm ? (
        <ReviewForm
          productId={productId}
          onSubmit={handleReviewSubmit}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button
          onClick={handleWriteReviewClick}
          className="inline-flex items-center gap-2 rounded-lg border border-gold px-5 py-2.5 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-obsidian"
        >
          <PenLine className="h-4 w-4" />
          Write a Review
        </button>
      )}

      {reviews.length > 0 ? (
        <ReviewList reviews={reviews} onHelpful={handleHelpful} totalReviews={totalReviews} />
      ) : (
        !showForm && (
          <p className="text-sm text-ink-muted">
            No reviews yet. Be the first to review this product!
          </p>
        )
      )}
    </div>
  );
};

export default Reviews;
