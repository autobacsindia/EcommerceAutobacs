import React, { useState } from 'react';
import ReviewItem from './ReviewItem';
import styles from './ReviewList.module.css';

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

const ReviewList: React.FC<ReviewListProps> = ({ reviews, onHelpful, totalReviews }) => {
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'highest' | 'lowest' | 'helpful'>('newest');

  // Sort reviews based on selected option
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
    <div className={styles.reviewList}>
      <div className={styles.reviewListHeader}>
        <h3>{totalReviews} Reviews</h3>
        <div className={styles.sortContainer}>
          <label htmlFor="sort">Sort by:</label>
          <select 
            id="sort" 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as any)}
            className={styles.sortSelect}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="highest">Highest Rated</option>
            <option value="lowest">Lowest Rated</option>
            <option value="helpful">Most Helpful</option>
          </select>
        </div>
      </div>

      <div className={styles.reviewItems}>
        {sortedReviews.map((review) => (
          <ReviewItem
            key={review.id}
            {...review}
            onHelpful={onHelpful}
          />
        ))}
      </div>
    </div>
  );
};

export default ReviewList;