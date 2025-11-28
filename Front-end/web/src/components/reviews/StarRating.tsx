import React, { useState } from 'react';
import styles from './StarRating.module.css';

interface StarRatingProps {
  rating: number;
  interactive?: boolean;
  onRatingChange?: (rating: number) => void;
  size?: 'small' | 'medium' | 'large';
}

const StarRating: React.FC<StarRatingProps> = ({ 
  rating = 0, 
  interactive = false, 
  onRatingChange,
  size = 'medium'
}) => {
  const [hoverRating, setHoverRating] = useState(0);

  const handleClick = (ratingValue: number) => {
    if (interactive && onRatingChange) {
      onRatingChange(ratingValue);
    }
  };

  const handleMouseEnter = (ratingValue: number) => {
    if (interactive) {
      setHoverRating(ratingValue);
    }
  };

  const handleMouseLeave = () => {
    if (interactive) {
      setHoverRating(0);
    }
  };

  const displayRating = hoverRating || rating;

  return (
    <div 
      className={`${styles.starRating} ${styles[size]}`}
      onMouseLeave={handleMouseLeave}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`${styles.star} ${
            interactive ? styles.interactive : ''
          } ${
            star <= displayRating 
              ? styles.filled 
              : star - 0.5 <= displayRating 
              ? styles.halfFilled 
              : styles.empty
          }`}
          onClick={() => handleClick(star)}
          onMouseEnter={() => handleMouseEnter(star)}
          disabled={!interactive}
          aria-label={`Rate ${star} out of 5 stars`}
        >
          <svg 
            className={styles.starIcon} 
            viewBox="0 0 24 24" 
            fill="currentColor"
          >
            {star <= displayRating ? (
              // Full star
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            ) : star - 0.5 <= displayRating ? (
              // Half star
              <>
                <defs>
                  <linearGradient id={`half-${star}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="50%" stopColor="currentColor" />
                    <stop offset="50%" stopColor="transparent" />
                  </linearGradient>
                </defs>
                <path 
                  d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" 
                  fill={`url(#half-${star})`} 
                />
              </>
            ) : (
              // Empty star
              <path 
                d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="1"
              />
            )}
          </svg>
        </button>
      ))}
      <span className={styles.ratingText}>
        {rating.toFixed(1)}
      </span>
    </div>
  );
};

export default StarRating;