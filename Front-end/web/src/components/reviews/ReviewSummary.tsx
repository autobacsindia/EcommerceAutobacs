'use client';

import React from 'react';
import StarRating from './StarRating';

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
  ratingDistribution,
}) => {
  const percentageFor = (count: number) =>
    totalReviews === 0 ? 0 : Math.round((count / totalReviews) * 100);

  return (
    <div className="flex flex-col gap-8 rounded-2xl border border-hairline bg-obsidian-raised/40 p-6 sm:flex-row sm:items-center sm:gap-12">
      {/* Overall */}
      <div className="flex flex-col items-center gap-2 sm:min-w-[140px]">
        <div className="flex items-baseline gap-1">
          <span className="text-5xl font-light text-ink">{averageRating.toFixed(1)}</span>
          <span className="text-lg text-ink-muted">/5</span>
        </div>
        <StarRating rating={averageRating} size="medium" />
        <div className="text-sm text-ink-muted">
          {totalReviews} {totalReviews === 1 ? 'Review' : 'Reviews'}
        </div>
      </div>

      {/* Distribution */}
      <div className="flex flex-1 flex-col gap-2">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = ratingDistribution[star.toString() as keyof typeof ratingDistribution];
          const pct = percentageFor(count);
          return (
            <div key={star} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs text-ink-muted">{star} star{star > 1 ? 's' : ''}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-obsidian-deep">
                <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right text-xs text-ink-muted">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ReviewSummary;
