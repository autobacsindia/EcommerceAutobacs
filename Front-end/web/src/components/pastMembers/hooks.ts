'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { pastMemberKeys } from '@/hooks/queries/keys';
import type { PastMember, PastMemberProfile, PastOrder, PastTask } from './types';

const BASE = '/staff/past-members';
const qs = (params: Record<string, string>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return s ? `?${s}` : '';
};

/** `team` is only sent by admins; the API ignores it for everyone else. */
export function usePastMembers(team: string) {
  return useInfiniteQuery({
    queryKey: pastMemberKeys.list(team),
    queryFn: ({ pageParam }) => apiClient.get<{ members: PastMember[]; nextCursor: string | null }>(`${BASE}${qs({ team, cursor: pageParam })}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
}

export function usePastMember(id: string) {
  return useQuery({ queryKey: pastMemberKeys.one(id), queryFn: () => apiClient.get<{ member: PastMemberProfile }>(`${BASE}/${id}`).then((r) => r.member) });
}

export function usePastMemberTasks(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: pastMemberKeys.tasks(id),
    queryFn: ({ pageParam }) => apiClient.get<{ tasks: PastTask[]; nextCursor: string | null }>(`${BASE}/${id}/tasks${qs({ cursor: pageParam })}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}

export function usePastMemberOrders(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: pastMemberKeys.orders(id),
    queryFn: ({ pageParam }) => apiClient.get<{ orders: PastOrder[]; nextCursor: string | null }>(`${BASE}/${id}/orders${qs({ cursor: pageParam })}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}
