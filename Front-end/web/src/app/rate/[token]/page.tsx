'use client';

/**
 * Rate our team, from the signed link in the post-delivery email. No login:
 * the token names one delivered order. One rating per order; the customer can
 * change it for 7 days, then it is locked (the server enforces both).
 * `?stars=N` comes from the star the customer tapped in the email.
 */
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertCircle, Star } from 'lucide-react';
import apiClient from '@/lib/api';
import { orderRatingKeys } from '@/hooks/queries/keys';
import ServiceRatingForm, { ratingEditNote, type ServiceRatingView } from '@/components/orderRating/ServiceRatingForm';

interface LinkState {
  orderRef: string;
  rating: ServiceRatingView | null;
}

function RateByLink() {
  const { token } = useParams<{ token: string }>();
  const tapped = Number(useSearchParams().get('stars')) || 0;
  const [saved, setSaved] = useState<ServiceRatingView | null>(null);

  const q = useQuery({
    queryKey: orderRatingKeys.link(token),
    queryFn: () => apiClient.get<{ success: boolean } & LinkState>(`/order-ratings/link/${token}`),
    retry: false,
  });

  if (q.isPending) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-gold" aria-label="Loading" />
      </main>
    );
  }

  if (q.isError) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-ink-muted" aria-hidden />
        <h1 className="mt-4 text-xl font-bold text-ink">We could not open this link</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          {q.error instanceof Error ? q.error.message : 'This rating link is not valid.'}
        </p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-gold px-6 py-3 text-[14px] font-semibold text-white">
          Go to the store
        </Link>
      </main>
    );
  }

  const current = saved || q.data.rating;

  if (saved) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-gold" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold text-ink">Thank you</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          You rated our team {saved.stars} out of 5. {ratingEditNote(saved)}
        </p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-gold px-6 py-3 text-[14px] font-semibold text-white">
          Go to the store
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-[23px] font-bold leading-tight tracking-[-0.01em] text-ink">
        How was your experience with our team?
      </h1>
      <p className="mt-1 text-[15px] text-ink-muted">
        Order {q.data.orderRef}. Your answer goes to our managers and helps us look after you better.
      </p>

      {current?.locked ? (
        <div className="mt-6 rounded-xl border border-hairline bg-white p-5 text-center">
          <div className="flex justify-center gap-1" aria-label={`${current.stars} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={`h-7 w-7 ${current.stars >= n ? 'fill-gold text-gold' : 'text-hairline'}`} aria-hidden />
            ))}
          </div>
          <p className="mt-3 text-[15px] text-ink-muted">{ratingEditNote(current)}</p>
        </div>
      ) : (
        <div className="mt-6">
          {current && <p className="mb-4 text-[14px] text-ink-muted">You already rated this order. {ratingEditNote(current)}</p>}
          <ServiceRatingForm
            initialStars={tapped || current?.stars || 0}
            initialComment={current?.comment || ''}
            submitLabel={current ? 'Update my rating' : 'Send my rating'}
            onSubmit={async (input) => {
              const res = await apiClient.post<{ rating: ServiceRatingView }>(`/order-ratings/link/${token}`, input);
              setSaved(res.rating);
            }}
          />
        </div>
      )}
    </main>
  );
}

/** useSearchParams() needs a Suspense boundary, or the build bails out of prerendering. */
export default function RateByLinkPage() {
  return (
    <Suspense fallback={null}>
      <RateByLink />
    </Suspense>
  );
}
