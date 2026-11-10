'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { pastMemberKeys } from '@/hooks/queries/keys';
import type { PastMember, PastMemberNote, PastMemberProfile, PastOrder, PastTask } from './types';

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

export function usePastMemberNotes(id: string) {
  return useInfiniteQuery({
    queryKey: pastMemberKeys.notes(id),
    queryFn: ({ pageParam }) => apiClient.get<{ notes: PastMemberNote[]; canWrite: boolean; nextCursor: string | null }>(`${BASE}/${id}/notes${qs({ cursor: pageParam })}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
}

/** Every note change reloads the list from the server: no guessing at order or rights. */
function useNoteMutation<V>(id: string, fn: (v: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pastMemberKeys.notes(id) }),
  });
}

export const useAddNote = (id: string) => useNoteMutation(id, (body: string) => apiClient.post(`${BASE}/${id}/notes`, { body }));
export const useEditNote = (id: string) => useNoteMutation(id, (v: { noteId: string; body: string; rev: number }) => apiClient.patch(`${BASE}/${id}/notes/${v.noteId}`, { body: v.body, rev: v.rev }));
export const useDeleteNote = (id: string) => useNoteMutation(id, (noteId: string) => apiClient.delete(`${BASE}/${id}/notes/${noteId}`));
