'use client';

/**
 * "My reviews" on the profile page — the customer's own product reviews, each
 * with Edit.
 *
 * Editing never publishes straight away: the server (PUT /reviews/:id) checks
 * the review is the customer's own and sends it back for approval, so an edited
 * review drops off the product page until the team checks it again. The card
 * says so before and after saving. Photos are left as they are (not sent).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Star } from 'lucide-react';
import apiClient from '@/lib/api-client';
import profileService from '@/lib/profileService';
import { profileKeys } from '@/hooks/queries/keys';
import { formatDateIST } from '@/lib/datetime';
import type { UserReview } from '@/lib/types';
import { CUSTOMER_TEXT_MAX, isOverLimit } from '@/lib/textLimit';
import { TextLimitNote } from '@/components/ui/TextLimitNote';

const SHOWN = 10;
const TITLE_MAX = 100;
const COMMENT_MIN = 10;
const COMMENT_MAX = CUSTOMER_TEXT_MAX; // = server CUSTOMER_COMMENT_MAX

/** The server stores sanitised HTML text, so `&` comes back as `&amp;`. Decode for the textarea. */
export function decodeEntities(s: string | undefined): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

const errorText = (e: unknown) =>
  (e as { rawData?: { message?: string; errors?: { msg?: string }[] } })?.rawData?.errors?.[0]?.msg
  || (e as { rawData?: { message?: string } })?.rawData?.message
  || 'Could not save your review. Please try again.';

function ReviewEditor({ review, onDone, onCancel }: { review: UserReview; onDone: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(review.rating);
  const [title, setTitle] = useState(decodeEntities(review.title));
  const [comment, setComment] = useState(decodeEntities(review.comment));

  const save = useMutation({
    mutationFn: () => apiClient.put(`/reviews/${encodeURIComponent(review.id)}`, { rating, title: title.trim(), comment: comment.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.myReviews() });
      onDone();
    },
  });
  const tooShort = comment.trim().length < COMMENT_MIN;

  return (
    <form className="mt-3 space-y-3" aria-label={`Edit review of ${review.product?.name ?? 'product'}`}
      onSubmit={(e) => { e.preventDefault(); if (!tooShort && !save.isPending) save.mutate(); }}>
      <fieldset>
        <legend className="text-xs font-display text-ink-muted mb-1">Rating</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? '' : 's'}`} aria-pressed={rating === n}
              className="p-1">
              <Star className={`h-5 w-5 ${n <= rating ? 'fill-gold text-gold' : 'text-ink-muted'}`} />
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block text-xs font-display text-ink-muted">Title
        <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border border-hairline bg-transparent px-3 py-2 text-sm text-ink" />
      </label>
      <label className="block text-xs font-display text-ink-muted">Your review
        <textarea value={comment} rows={4} onChange={(e) => setComment(e.target.value)}
          className="mt-1 w-full rounded border border-hairline bg-transparent px-3 py-2 text-sm text-ink" />
      </label>
      {tooShort && <p className="text-xs text-ink-muted">Write at least {COMMENT_MIN} characters.</p>}
      <TextLimitNote value={comment.trim()} max={COMMENT_MAX} />
      <p className="text-xs text-ink-muted">After you save, your review is checked again before it shows on the product page.</p>
      {save.isError && <p role="alert" className="text-sm text-red-500">{errorText(save.error)}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={tooShort || isOverLimit(comment.trim(), COMMENT_MAX) || save.isPending}
          className="bg-gold text-white px-4 py-2 rounded-lg text-sm font-display font-bold disabled:opacity-50">
          {save.isPending ? 'Saving…' : 'Save review'}
        </button>
        <button type="button" onClick={onCancel} disabled={save.isPending} className="px-4 py-2 rounded-lg text-sm font-display border border-hairline text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function MyReviewsCard() {
  const [editing, setEditing] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const { data: reviews } = useQuery({
    queryKey: profileKeys.myReviews(),
    queryFn: () => profileService.getMyReviews(1, SHOWN).then((r) => r.reviews || []),
  });

  // Nothing to show until loaded, and no empty card for someone who never reviewed.
  if (!reviews || reviews.length === 0) return null;

  return (
    <div className="bg-obsidian border border-hairline rounded-lg p-6 mb-6">
      <div className="flex items-center gap-2 mb-5">
        <MessageSquare className="h-4 w-4 text-gold" />
        <h2 className="text-[12px] font-display font-bold text-ink-muted uppercase tracking-[0.12em]">My Reviews</h2>
      </div>
      <ul className="divide-y divide-hairline">
        {reviews.map((r) => (
          <li key={r.id} className="py-3" data-testid="my-review">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-display text-ink truncate">
                  {r.product?.slug
                    ? <Link href={`/products/${r.product.slug}`} className="hover:text-gold">{r.product.name}</Link>
                    : (r.product?.name ?? 'Product no longer available')}
                </p>
                <p className="text-xs text-ink-muted font-display mt-0.5">
                  {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} · {formatDateIST(r.createdAt)} · {r.isApproved ? 'Published' : 'Waiting for approval'}
                </p>
              </div>
              {editing !== r.id && (
                <button type="button" onClick={() => { setEditing(r.id); setSavedId(null); }}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-display text-gold hover:text-gold/80">
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              )}
            </div>
            {editing === r.id ? (
              <ReviewEditor review={r} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); setSavedId(r.id); }} />
            ) : (
              <>
                {r.title && <p className="mt-2 text-sm font-display text-ink">{decodeEntities(r.title)}</p>}
                <p className="mt-1 text-sm text-ink-muted whitespace-pre-line">{decodeEntities(r.comment)}</p>
                {savedId === r.id && <p role="status" className="mt-2 text-xs text-gold">Saved. We&apos;ll check it again before it shows on the product page.</p>}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
