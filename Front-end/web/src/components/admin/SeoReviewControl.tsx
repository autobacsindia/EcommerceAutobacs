'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { adminKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import { SEO_REVIEW, SEO_REVIEW_STATUSES, seoReviewStatus, type SeoReview, type SeoReviewStatus } from '@/lib/seoReview';

/**
 * SEO team's progress marker for this product: Needs check → Working → Completed.
 *
 * Saves on its own the moment a button is pressed (not with the product form),
 * so marking progress never risks the rest of the edit — and a product save
 * can never undo it.
 */
export default function SeoReviewControl({ productId, initial }: { productId: string; initial?: SeoReview | null }) {
  const queryClient = useQueryClient();
  const [review, setReview] = useState<SeoReview | null>(initial || null);
  const [saving, setSaving] = useState<SeoReviewStatus | null>(null);
  const [error, setError] = useState('');
  const current = seoReviewStatus(review);

  async function set(status: SeoReviewStatus) {
    if (status === current && review?.status) return;
    setSaving(status);
    setError('');
    try {
      const res = await apiClient.patch<{ success: boolean; seoReview: SeoReview }>(`/products/${productId}/seo-review`, { status });
      setReview(res.seoReview);
      queryClient.invalidateQueries({ queryKey: adminKeys.resource('products') });
    } catch (e) {
      setError((e as { rawData?: { message?: string } })?.rawData?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3 rounded-lg bg-white p-4 shadow">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">SEO work</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${SEO_REVIEW[current].badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${SEO_REVIEW[current].dot}`} /> {SEO_REVIEW[current].label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="SEO work status">
        {SEO_REVIEW_STATUSES.map((s) => {
          const active = s === current;
          return (
            <button
              key={s}
              type="button"
              disabled={saving !== null}
              aria-pressed={active}
              onClick={() => set(s)}
              className={`inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                active ? SEO_REVIEW[s].button : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {saving === s ? <Loader2 className="h-3 w-3 animate-spin" /> : s === 'done' && <CheckCircle2 className="h-3 w-3" />}
              {SEO_REVIEW[s].label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-500">
        {review?.updatedAt ? `Updated ${formatDateTimeIST(review.updatedAt)}` : 'Not marked yet'} · saves instantly
      </p>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
