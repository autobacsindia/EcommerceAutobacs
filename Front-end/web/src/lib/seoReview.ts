/**
 * SEO team's work status per product (admin "SEO work").
 *
 * Colours follow the usual traffic-light reading so the list scans at a glance:
 * blue = still to look at, amber = someone is on it, green = done. A product
 * that has never been marked counts as "Needs check".
 */

export type SeoReviewStatus = 'todo' | 'in_progress' | 'done';

export interface SeoReview {
  status?: SeoReviewStatus | null;
  updatedAt?: string | null;
}

export const SEO_REVIEW_STATUSES: SeoReviewStatus[] = ['todo', 'in_progress', 'done'];

export const SEO_REVIEW: Record<SeoReviewStatus, { label: string; badge: string; button: string; dot: string }> = {
  todo: {
    label: 'Needs check',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    button: 'bg-blue-600 text-white border-blue-600',
    dot: 'bg-blue-500',
  },
  in_progress: {
    label: 'Working',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    button: 'bg-amber-500 text-white border-amber-500',
    dot: 'bg-amber-500',
  },
  done: {
    label: 'Completed',
    badge: 'bg-green-50 text-green-700 border-green-200',
    button: 'bg-green-600 text-white border-green-600',
    dot: 'bg-green-500',
  },
};

/** The status to show — never-marked products read as "Needs check". */
export const seoReviewStatus = (review?: SeoReview | null): SeoReviewStatus =>
  (review?.status && SEO_REVIEW_STATUSES.includes(review.status) ? review.status : 'todo');
