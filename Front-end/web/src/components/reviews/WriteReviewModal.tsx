'use client';

import { useState } from 'react';
import { X, Star, Loader2, AlertCircle } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { toast } from 'react-hot-toast';

interface WriteReviewModalProps {
  productId: string;
  productName: string;
  productImage?: string;
  orderId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function WriteReviewModal({
  productId,
  productName,
  productImage,
  orderId,
  onClose,
  onSuccess,
}: WriteReviewModalProps) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (rating === 0) {
      setError('Please select a star rating');
      return;
    }

    if (comment.trim().length < 10) {
      setError('Review comment must be at least 10 characters long');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      await apiClient.post(API_ENDPOINTS.CREATE_REVIEW, {
        product: productId,
        order: orderId,
        rating,
        title,
        comment,
      });

      toast.success('Review submitted successfully');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to submit review:', err);
      
      const errorMessage = err.message || 'Failed to submit review. Please try again.';
      
      // Handle duplicate review error gracefully
      if (errorMessage.toLowerCase().includes('already submitted a review')) {
        toast.error('You have already submitted a review for this product');
        onClose();
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-obsidian-deep bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-obsidian rounded-lg max-w-lg w-full flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-bold text-ink">Write a Review</h3>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink-muted transition"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          {/* Product Info */}
          <div className="flex items-center gap-4 mb-6 p-3 bg-obsidian-deep rounded-lg">
            {productImage ? (
              <img
                src={productImage}
                alt={productName}
                className="w-12 h-12 object-cover rounded"
              />
            ) : (
              <div className="w-12 h-12 bg-obsidian-raised rounded flex items-center justify-center text-ink-muted text-xs">
                No Img
              </div>
            )}
            <div>
              <p className="font-medium text-ink line-clamp-1">{productName}</p>
              <p className="text-sm text-ink-muted">Order ID: {orderId.slice(-6).toUpperCase()}</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-2">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Rating */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-ink/80">
                Overall Rating
              </label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className="p-1 focus:outline-none transition-transform hover:scale-110"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(star)}
                  >
                    <Star
                      className={`h-8 w-8 ${
                        star <= (hoverRating || rating)
                          ? 'fill-yellow-400 text-yellow-400'
                          : 'text-ink/70'
                      }`}
                    />
                  </button>
                ))}
                <span className="ml-2 text-sm font-medium text-ink-muted">
                  {hoverRating || rating ? (
                    <span className="text-yellow-600">
                      {hoverRating || rating} Star{(hoverRating || rating) > 1 ? 's' : ''}
                    </span>
                  ) : (
                    'Select a rating'
                  )}
                </span>
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <label htmlFor="title" className="block text-sm font-medium text-ink/80">
                Review Title (Optional)
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Summarize your experience"
                className="w-full px-3 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-gold transition"
              />
            </div>

            {/* Comment */}
            <div className="space-y-2">
              <label htmlFor="comment" className="block text-sm font-medium text-ink/80">
                Review Details
              </label>
              <textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                placeholder="What did you like or dislike? How was the quality?"
                className="w-full px-3 py-2 border border-hairline rounded-lg focus:ring-2 focus:ring-gold focus:border-gold transition resize-none"
              />
              <div className="flex justify-end">
                <span className={`text-xs ${comment.length > 0 && comment.length < 10 ? 'text-red-500' : 'text-ink-muted'}`}>
                  {comment.length} characters (min. 10)
                </span>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-ink/80 bg-obsidian border border-hairline rounded-lg hover:bg-obsidian-deep transition"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || rating === 0 || comment.trim().length < 10}
                className="px-4 py-2 text-sm font-medium text-obsidian bg-gold rounded-lg hover:bg-gold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Review'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
