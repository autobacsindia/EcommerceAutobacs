'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { trainingKeys } from '@/hooks/queries/keys';
import type { Assignment, AssignmentSummary, Attempt, OpenAttempt, Path, PathItem, PathQuestion, PathSummary, TrainingMeta } from './types';

export function useTrainingMeta() {
  return useQuery({ queryKey: trainingKeys.meta(), queryFn: () => apiClient.get<TrainingMeta>('/staff/training/meta'), staleTime: 60_000 });
}

export function useAssignmentPages(view: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: trainingKeys.list({ view }),
    queryFn: ({ pageParam }) => apiClient.get<{ assignments: AssignmentSummary[]; nextCursor: string | null }>(
      `/staff/training/assignments?${new URLSearchParams({ view, ...(pageParam ? { cursor: pageParam } : {}) })}`,
    ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}

export function usePathPages() {
  return useInfiniteQuery({
    queryKey: trainingKeys.paths(),
    queryFn: ({ pageParam }) => apiClient.get<{ paths: PathSummary[]; nextCursor: string | null }>(
      `/staff/training/paths?${new URLSearchParams(pageParam ? { cursor: pageParam } : {})}`,
    ),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
}

export function usePath(id: string | undefined) {
  return useQuery({
    queryKey: trainingKeys.path(id ?? ''),
    queryFn: () => apiClient.get<{ path: Path }>(`/staff/training/paths/${id}`).then((r) => r.path),
    enabled: !!id,
  });
}

export function useLessonOptions(team: string) {
  return useQuery({
    queryKey: trainingKeys.lessonOptions(team),
    queryFn: () => apiClient.get<{ lessons: { id: string; title: string }[] }>(`/staff/training/lesson-options?team=${team}`).then((r) => r.lessons),
    enabled: !!team,
  });
}

export function useAssignment(id: string) {
  return useQuery({
    queryKey: trainingKeys.one(id),
    queryFn: () => apiClient.get<{ assignment: Assignment }>(`/staff/training/assignments/${id}`).then((r) => r.assignment),
  });
}

export interface PathDraft { title: string; team?: string; items: PathItem[]; questions: PathQuestion[]; rev?: number }

export function useSavePath(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: PathDraft) => (id
      ? apiClient.patch<{ path: Path }>(`/staff/training/paths/${id}`, draft)
      : apiClient.post<{ path: Path }>('/staff/training/paths', draft)).then((r) => r.path),
    onSuccess: (path) => {
      queryClient.setQueryData(trainingKeys.path(path.id), path);
      void queryClient.invalidateQueries({ queryKey: trainingKeys.paths() });
    },
  });
}

export function useArchivePath(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete(`/staff/training/paths/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: trainingKeys.paths() }); },
  });
}

export function useAssignPath(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; buddyId: string }) => apiClient.post<{ assignment: Assignment }>(`/staff/training/paths/${id}/assign`, body).then((r) => r.assignment),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: trainingKeys.lists() }); },
  });
}

/** Every change here returns the assignment as the server now has it. */
function useApply(id: string) {
  const queryClient = useQueryClient();
  return (a: Assignment) => {
    queryClient.setQueryData(trainingKeys.one(id), a);
    void queryClient.invalidateQueries({ queryKey: trainingKeys.lists() });
  };
}

export function useAssignmentAction(id: string, action: 'allow-retry' | 'sign-off' | 'cancel') {
  const apply = useApply(id);
  return useMutation({
    mutationFn: () => apiClient.post<{ assignment: Assignment }>(`/staff/training/assignments/${id}/${action}`, {}).then((r) => r.assignment),
    onSuccess: apply,
  });
}

export function useStartTest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<{ attempt: OpenAttempt }>(`/staff/training/assignments/${id}/test`, {}).then((r) => r.attempt),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: trainingKeys.one(id) }); },
  });
}

export function useSubmitTest(id: string) {
  const apply = useApply(id);
  return useMutation({
    mutationFn: (body: { attemptId: string; answers: Record<string, number | string> }) =>
      apiClient.post<{ result: Attempt; assignment: Assignment }>(`/staff/training/assignments/${id}/test/submit`, body),
    onSuccess: (r) => apply(r.assignment),
  });
}

export function useMarkTest(id: string) {
  const apply = useApply(id);
  return useMutation({
    mutationFn: (body: { attemptId: string; marks: Record<string, boolean> }) =>
      apiClient.post<{ assignment: Assignment }>(`/staff/training/assignments/${id}/test/mark`, body).then((r) => r.assignment),
    onSuccess: apply,
  });
}
