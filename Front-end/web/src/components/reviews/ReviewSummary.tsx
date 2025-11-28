import React from 'react';
import StarRating from './StarRating';
import styles from './ReviewSummary.module.css';

interface ReviewSummaryProps {
  averageRating: number;
  totalReviews: number;
  ratingDistribution: {
    '5': number;
    '4': number;
    '3': number;
    '2': number;
    '1': number;
  };
}

const ReviewSummary: React.FC<ReviewSummaryProps> = ({ 
  averageRating, 
  totalReviews, 
  ratingDistribution 
}) => {
  // Calculate percentages for the distribution bars
  const calculatePercentage = (count: number) => {
    if (totalReviews === 0) return 0;
    return Math.round((count / totalReviews) * 100);
  };

  return (
    <div className={styles.reviewSummary}>
      <div className={styles.overallRating}>
        <div className={styles.ratingValue}>
          <span className={styles.averageRating}>{averageRating.toFixed(1)}</span>
          <span className={styles.maxRating}>/5</span>
        </div>
        <div className={styles.starsAndCount}>
          <StarRating rating={averageRating} size="large" />
          <div className={styles.totalReviews}>
            {totalReviews} {totalReviews === 1 ? 'Review' : 'Reviews'}
          </div>
        </div>
      </div>

      <div className={styles.ratingDistribution}>
        {[5, 4, 3, 2, 1].map((star) => {
          const count = ratingDistribution[star.toString() as keyof typeof ratingDistribution];
          const percentage = calculatePercentage(count);
          
          return (
            <div key={star} className={styles.distributionRow}>
              <span className={styles.starLabel}>{star} stars</span>
              <div className={styles.progressBarContainer}>
                <div 
                  className={styles.progressBar} 
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <span className={styles.count}>{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ReviewSummary;