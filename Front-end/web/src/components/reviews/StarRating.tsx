'use client';

import React, { useState } from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  rating?: number;
  interactive?: boolean;
  onRatingChange?: (rating: number) => void;
  size?: 'small' | 'medium' | 'large';
  /** Render the numeric value alongside the stars. */
  showValue?: boolean;
}

const SIZE: Record<NonNullable<StarRatingProps['size']>, string> = {
  small: 'h-4 w-4',
  medium: 'h-5 w-5',
  large: 'h-7 w-7',
};

/**
 * Obsidian + gold star rating. Two modes:
 *  - interactive: clickable stars for the review form (whole-star selection).
 *  - display: read-only stars with fractional fill (e.g. a 4.3 average) via a
 *    width-clipped gold overlay layered over an empty base row.
 */
const StarRating: React.FC<StarRatingProps> = ({
  rating = 0,
  interactive = false,
  onRatingChange,
  size = 'medium',
  showValue = false,
}) => {
  const [hoverRating, setHoverRating] = useState(0);
  const starCls = SIZE[size];

  if (interactive) {
    const active = hoverRating || rating;
    return (
      <div className="flex items-center gap-1" onMouseLeave={() => setHoverRating(0)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className="p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded"
            onMouseEnter={() => setHoverRating(star)}
            onClick={() => onRatingChange?.(star)}
            aria-label={`Rate ${star} out of 5 stars`}
          >
            <Star
              className={`${starCls} ${
                star <= active ? 'fill-gold text-gold' : 'text-ink-muted'
              }`}
            />
          </button>
        ))}
      </div>
    );
  }

  const fillPct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative inline-flex"
        role="img"
        aria-label={`Rated ${rating.toFixed(1)} out of 5 stars`}
      >
        <div className="flex">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star key={star} className={`${starCls} text-ink-muted`} />
          ))}
        </div>
        <div
          className="absolute inset-0 flex overflow-hidden"
          style={{ width: `${fillPct}%` }}
          aria-hidden="true"
        >
          {[1, 2, 3, 4, 5].map((star) => (
            <Star key={star} className={`${starCls} shrink-0 fill-gold text-gold`} />
          ))}
        </div>
      </div>
      {showValue && <span className="text-sm text-ink-muted">{rating.toFixed(1)}</span>}
    </div>
  );
};

export default StarRating;
