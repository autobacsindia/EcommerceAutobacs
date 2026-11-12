'use client';

/**
 * On the customer's own order page: rate our team once the order is delivered.
 * Hidden for every other status (the server refuses them too).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import apiClient from '@/lib/api';
import { orderRatingKeys } from '@/hooks/queries/keys';
import ServiceRatingForm, { ratingEditNote, type ServiceRatingView } from './ServiceRatingForm';

interface MineState {
  rateable: boolean;
  rating: ServiceRatingView | null;
}

export default function OrderServiceRatingCard({ orderId, status }: { orderId: string; status: string }) {
  const queryClient = useQueryClient();
  const delivered = status === 'delivered';
  const q = useQuery({
    queryKey: orderRatingKeys.mine(orderId),
    queryFn: () => apiClient.get<{ success: boolean } & MineState>(`/order-ratings/mine/${orderId}`),
    enabled: delivered,
    retry: false,
  });

  if (!delivered || !q.data?.rateable) return null;
  const rating = q.data.rating;

  return (
    <section className="mb-6 rounded-lg border border-hairline bg-white p-6" aria-labelledby="service-rating-title">
      <h2 id="service-rating-title" className="font-display font-bold uppercase tracking-wide text-ink">
        How was your experience with our team?
      </h2>
      {rating?.locked ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="flex gap-0.5" aria-label={`${rating.stars} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={`h-5 w-5 ${rating.stars >= n ? 'fill-gold text-gold' : 'text-hairline'}`} aria-hidden />
            ))}
          </span>
          <span className="text-[14px] text-ink-muted">{ratingEditNote(rating)}</span>
        </div>
      ) : (
        <div className="mt-3">
          {rating && <p className="mb-3 text-[14px] text-ink-muted">You rated us {rating.stars}/5. {ratingEditNote(rating)}</p>}
          <ServiceRatingForm
            key={rating?.updatedAt || 'new'}
            initialStars={rating?.stars || 0}
            initialComment={rating?.comment || ''}
            submitLabel={rating ? 'Update my rating' : 'Send my rating'}
            onSubmit={async (input) => {
              await apiClient.post(`/order-ratings/mine/${orderId}`, input);
              await queryClient.invalidateQueries({ queryKey: orderRatingKeys.mine(orderId) });
            }}
          />
        </div>
      )}
    </section>
  );
}
