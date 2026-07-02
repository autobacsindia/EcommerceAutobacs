'use client';

import React from 'react';
import { ThumbsUp, BadgeCheck } from 'lucide-react';
import StarRating from './StarRating';
import EnhancedImage from '@/components/layout/EnhancedImage';

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
  onHelpful,
}) => {
  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  return (
    <div className="border-b border-hairline py-6 first:pt-0 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-soft text-sm font-medium text-gold">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-medium text-ink">{user.name}</div>
            <div className="text-xs text-ink-muted">{formatDate(createdAt)}</div>
          </div>
        </div>
        {isVerifiedPurchase && (
          <span className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2.5 py-1 text-xs font-medium text-gold">
            <BadgeCheck className="h-3.5 w-3.5" />
            Verified Purchase
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <StarRating rating={rating} size="small" />
        {title && <h4 className="font-semibold text-ink">{title}</h4>}
        <p className="whitespace-pre-line text-sm leading-relaxed text-ink/80">{comment}</p>

        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {images.map((image, index) => (
              <div
                key={index}
                className="h-20 w-20 overflow-hidden rounded-lg border border-hairline bg-obsidian-raised"
              >
                <EnhancedImage
                  src={image.url}
                  alt={image.alt || `Review image ${index + 1}`}
                  width={80}
                  height={80}
                  className="h-full w-full object-cover"
                  context="product"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <button
          onClick={() => onHelpful?.(id)}
          className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-gold hover:text-gold"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          Helpful ({helpfulCount})
        </button>
      </div>
    </div>
  );
};

export default ReviewItem;
