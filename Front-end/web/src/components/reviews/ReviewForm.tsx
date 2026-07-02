'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import StarRating from './StarRating';

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

const inputCls =
  'w-full rounded-lg border border-hairline bg-obsidian-raised px-3 py-2 text-ink placeholder:text-ink-muted focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold transition-colors';

const ReviewForm: React.FC<ReviewFormProps> = ({ onSubmit, onCancel }) => {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      await onSubmit({ rating, title, comment, images: [] });
      setRating(0);
      setTitle('');
      setComment('');
    } catch (error) {
      console.error('Error submitting review:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-hairline bg-obsidian-raised/40 p-6">
      <h3 className="mb-4 text-lg font-medium text-ink">Write a Review</h3>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="rating" className="block text-sm font-medium text-ink/80">
            Rating *
          </label>
          <StarRating rating={rating} interactive onRatingChange={setRating} size="large" />
          {errors.rating && <span className="block text-sm text-red-400">{errors.rating}</span>}
        </div>

        <div className="space-y-2">
          <label htmlFor="title" className="block text-sm font-medium text-ink/80">
            Title
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summarize your review (optional)"
            className={inputCls}
          />
          {errors.title && <span className="block text-sm text-red-400">{errors.title}</span>}
        </div>

        <div className="space-y-2">
          <label htmlFor="comment" className="block text-sm font-medium text-ink/80">
            Comment *
          </label>
          <textarea
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Share your experience with this product"
            rows={5}
            className={`${inputCls} resize-none`}
          />
          <div className="text-right text-xs text-ink-muted">{comment.length}/1000</div>
          {errors.comment && <span className="block text-sm text-red-400">{errors.comment}</span>}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-2.5 text-sm font-medium text-obsidian transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Submitting...' : 'Submit Review'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-medium text-ink/80 transition-colors hover:bg-obsidian-raised disabled:opacity-50"
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
