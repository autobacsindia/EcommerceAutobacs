'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { postForm } from '@/lib/postForm';
import { googleReviewKeys, incentiveKeys } from './keys';
import type { GoogleReview, ReviewFilter, ReviewPage, ReviewPolicy } from '@/lib/googleReviews';

/** What this person may do, and the points scale. */
export function useGoogleReviewPolicy() {
  return useQuery({
    queryKey: googleReviewKeys.policy(),
    queryFn: () => apiClient.get<ReviewPolicy>('/google-reviews/policy'),
    staleTime: 5 * 60 * 1000,
  });
}

const qs = (status: ReviewFilter, cursor: string) => `?status=${status}${cursor ? `&cursor=${cursor}` : ''}`;

/** My own submissions (cursor-paginated). */
export function useMyGoogleReviews(status: ReviewFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: googleReviewKeys.mine(status),
    queryFn: ({ pageParam }) => apiClient.get<ReviewPage>(`/google-reviews/mine${qs(status, pageParam)}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Everyone's submissions — marketing head and admins (cursor-paginated). */
export function useGoogleReviewQueue(status: ReviewFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: googleReviewKeys.queue(status),
    queryFn: ({ pageParam }) => apiClient.get<ReviewPage>(`/google-reviews${qs(status, pageParam)}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** One submission with its history; seeded from the list row so it opens instantly. */
export function useGoogleReview(id: string, initial?: GoogleReview) {
  return useQuery({
    queryKey: googleReviewKeys.detail(id),
    queryFn: () => apiClient.get<{ review: GoogleReview }>(`/google-reviews/${id}`).then((r) => r.review),
    initialData: initial,
    staleTime: 0,
  });
}

/** Refetch every list and the Roav Points figures a change can move. Never guessed locally. */
function useRefreshAfterChange() {
  const qc = useQueryClient();
  return (review?: GoogleReview) => {
    if (review) qc.setQueryData(googleReviewKeys.detail(review.id), review);
    qc.invalidateQueries({ queryKey: googleReviewKeys.all });
    qc.invalidateQueries({ queryKey: incentiveKeys.all });
  };
}

export function useSubmitGoogleReview() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: (form: FormData) => postForm<{ review: GoogleReview }>('/google-reviews', form).then((r) => r.review),
    onSuccess: (review) => refresh(review),
  });
}

export function useVerifyGoogleReview() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; stars: number; points: number; expectedVersion: number }) =>
      apiClient.post<{ review: GoogleReview; changed: boolean }>(`/google-reviews/${id}/verify`, body).then((r) => r.review),
    onSuccess: (review) => refresh(review),
    // A 409 means someone else changed it: show them the latest.
    onError: () => refresh(),
  });
}

export function useRejectGoogleReview() {
  const refresh = useRefreshAfterChange();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; reason: string; expectedVersion: number }) =>
      apiClient.post<{ review: GoogleReview; changed: boolean }>(`/google-reviews/${id}/reject`, body).then((r) => r.review),
    onSuccess: (review) => refresh(review),
    onError: () => refresh(),
  });
}

export interface MyReviewRow {
  id: string; review: string | null; type: 'earn' | 'reverse'; points: number; reason: string | null;
  at: string; stars: number | null; customerName: string; orderNumber: string; earnMonth: string | null;
}

/** My Google review bonus rows on the Roav Points statement. */
export function useMyReviewBonus(month: string) {
  return useQuery({
    queryKey: incentiveKeys.myReviews(month),
    queryFn: () => apiClient.get<{ rows: MyReviewRow[]; points: number }>(`/incentives/me/reviews?month=${month}`),
  });
}
