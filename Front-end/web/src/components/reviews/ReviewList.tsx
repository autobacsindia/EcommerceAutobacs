'use client';

import React, { useState } from 'react';
import ReviewItem from './ReviewItem';

interface Review {
  id: string;
  user: {
    id: string;
    name: string;
  };
  rating: number;
  title?: string;
  comment: string;
  images?: { url: string; alt?: string }[];
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  createdAt: string;
}

interface ReviewListProps {
  reviews: Review[];
  onHelpful: (reviewId: string) => void;
  totalReviews: number;
}

type SortOption = 'newest' | 'oldest' | 'highest' | 'lowest' | 'helpful';

const ReviewList: React.FC<ReviewListProps> = ({ reviews, onHelpful, totalReviews }) => {
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  const sortedReviews = [...reviews].sort((a, b) => {
    switch (sortBy) {
      case 'newest':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case 'oldest':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'highest':
        return b.rating - a.rating;
      case 'lowest':
        return a.rating - b.rating;
      case 'helpful':
        return b.helpfulCount - a.helpfulCount;
      default:
        return 0;
    }
  });

  return (
    <div className="mt-8">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h3 className="text-lg font-medium text-ink">{totalReviews} Reviews</h3>
        <div className="flex items-center gap-2">
          <label htmlFor="review-sort" className="text-sm text-ink-muted">
            Sort by:
          </label>
          <select
            id="review-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="rounded-lg border border-hairline bg-obsidian-raised px-3 py-1.5 text-sm text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="highest">Highest Rated</option>
            <option value="lowest">Lowest Rated</option>
            <option value="helpful">Most Helpful</option>
          </select>
        </div>
      </div>

      <div>
        {sortedReviews.map((review) => (
          <ReviewItem key={review.id} {...review} onHelpful={onHelpful} />
        ))}
      </div>
    </div>
  );
};

export default ReviewList;
