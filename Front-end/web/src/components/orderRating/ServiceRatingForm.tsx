'use client';

/**
 * "How was your experience with our team?" — 1–5 stars and an optional comment.
 * Used by the signed-link page (/rate/[token]) and the customer's own order page.
 * The parent owns the request; this only collects input. Nothing here is shown
 * as saved until the server says it was (onSubmit resolves).
 */
import { useState } from 'react';
import { Star, Loader2 } from 'lucide-react';

export const RATING_COMMENT_MAX = 500;

export interface ServiceRatingView {
  stars: number;
  comment: string;
  createdAt: string;
  updatedAt?: string;
  editableUntil: string;
  locked: boolean;
}

interface Props {
  initialStars?: number;
  initialComment?: string;
  submitLabel: string;
  onSubmit: (input: { stars: number; comment: string }) => Promise<void>;
}

const LABELS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

export default function ServiceRatingForm({ initialStars = 0, initialComment = '', submitLabel, onSubmit }: Props) {
  const [stars, setStars] = useState(initialStars >= 1 && initialStars <= 5 ? initialStars : 0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState(initialComment);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const shown = hovered || stars;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stars < 1 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ stars, comment: comment.trim() });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="text-[14px] font-semibold text-ink">Your rating</legend>
        <div className="mt-2 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              aria-pressed={stars === n}
              className="p-1"
            >
              <Star className={`h-9 w-9 ${shown >= n ? 'fill-gold text-gold' : 'text-hairline'}`} />
            </button>
          ))}
          <span className="ml-2 text-[14px] text-ink-muted" aria-live="polite">{LABELS[shown] || ''}</span>
        </div>
      </fieldset>

      <div>
        <label htmlFor="service-rating-comment" className="block text-[14px] font-semibold text-ink">
          Anything to add? <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="service-rating-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={RATING_COMMENT_MAX}
          rows={3}
          placeholder="Was our team helpful, quick and clear?"
          className="mt-2 w-full rounded-lg border border-hairline px-4 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-gold"
        />
      </div>

      {error && <p role="alert" className="text-[14px] text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={stars < 1 || submitting}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-gold px-6 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {submitting ? 'Sending…' : submitLabel}
      </button>
    </form>
  );
}

/** "Rated 4★ — you can change it until 18 Nov" or "locked". */
export function ratingEditNote(r: ServiceRatingView): string {
  if (r.locked) return 'Your rating is saved. Thank you!';
  const until = new Date(r.editableUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `You can change it until ${until}.`;
}
