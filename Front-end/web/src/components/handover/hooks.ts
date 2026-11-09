'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { handoverKeys } from '@/hooks/queries/keys';
import type { Departure } from './types';

const BASE = '/staff/departures';

export function useDeparturePages(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: handoverKeys.list(),
    queryFn: ({ pageParam }) => apiClient.get<{ departures: Departure[]; nextCursor: string | null }>(`${BASE}${pageParam ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}

export function useMyHandovers() {
  return useQuery({ queryKey: handoverKeys.mine(), queryFn: () => apiClient.get<{ departures: Departure[] }>(`${BASE}/mine`).then((r) => r.departures) });
}

export function useDeparture(id: string) {
  return useQuery({ queryKey: handoverKeys.one(id), queryFn: () => apiClient.get<{ departure: Departure }>(`${BASE}/${id}`).then((r) => r.departure) });
}

function useApply() {
  const queryClient = useQueryClient();
  return (d: Departure) => {
    queryClient.setQueryData(handoverKeys.one(d.id), d);
    void queryClient.invalidateQueries({ queryKey: handoverKeys.list() });
    void queryClient.invalidateQueries({ queryKey: handoverKeys.mine() });
  };
}

export function useRecordDeparture() {
  const apply = useApply();
  return useMutation({
    mutationFn: (body: { userId: string; lastDay: string; reason: string; successorId: string }) => apiClient.post<{ departure: Departure }>(BASE, body).then((r) => r.departure),
    onSuccess: apply,
  });
}

export function useUpdateDeparture(id: string) {
  const apply = useApply();
  return useMutation({
    mutationFn: (body: { rev: number; lastDay?: string; reason?: string; successorId?: string; note?: string }) => apiClient.patch<{ departure: Departure }>(`${BASE}/${id}`, body).then((r) => r.departure),
    onSuccess: apply,
  });
}

export function useCancelDeparture(id: string) {
  const apply = useApply();
  return useMutation({
    mutationFn: () => apiClient.post<{ departure: Departure }>(`${BASE}/${id}/cancel`, {}).then((r) => r.departure),
    onSuccess: apply,
  });
}
