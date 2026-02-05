import React from 'react';
import StarRating from './StarRating';
import EnhancedImage from '@/components/layout/EnhancedImage';
import styles from './ReviewItem.module.css';

interface ReviewItemProps {
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
  onHelpful?: (reviewId: string) => void;
}

const ReviewItem: React.FC<ReviewItemProps> = ({ 
  id,
  user,
  rating,
  title,
  comment,
  images = [],
  isVerifiedPurchase,
  helpfulCount,
  createdAt,
  onHelpful
}) => {
  // Format the date for display
  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  const handleHelpfulClick = () => {
    if (onHelpful) {
      onHelpful(id);
    }
  };

  return (
    <div className={styles.reviewItem}>
      <div className={styles.reviewHeader}>
        <div className={styles.userInfo}>
          <div className={styles.userAvatar}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className={styles.userDetails}>
            <div className={styles.userName}>{user.name}</div>
            <div className={styles.reviewDate}>{formatDate(createdAt)}</div>
          </div>
        </div>
        {isVerifiedPurchase && (
          <div className={styles.verifiedBadge}>
            Verified Purchase
          </div>
        )}
      </div>

      <div className={styles.reviewContent}>
        <StarRating rating={rating} />
        {title && <h4 className={styles.reviewTitle}>{title}</h4>}
        <p className={styles.reviewComment}>{comment}</p>
        
        {images.length > 0 && (
          <div className={styles.reviewImages}>
            {images.map((image, index) => (
              <div key={index} className={styles.imageContainer}>
                <EnhancedImage 
                  src={image.url} 
                  alt={image.alt || `Review image ${index + 1}`} 
                  width={100}
                  height={100}
                  className={styles.reviewImage}
                  context="product"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.reviewActions}>
        <button 
          onClick={handleHelpfulClick}
          className={styles.helpfulButton}
        >
          Helpful ({helpfulCount})
        </button>
      </div>
    </div>
  );
};

export default ReviewItem;