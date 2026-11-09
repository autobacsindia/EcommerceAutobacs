'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { lessonKeys } from '@/hooks/queries/keys';
import { lessonFileType, type Lesson, type LessonDraft, type LessonMeta, type LessonPage, type LessonProgressPerson } from './types';

export function useLessonMeta() {
  return useQuery({ queryKey: lessonKeys.meta(), queryFn: () => apiClient.get<LessonMeta>('/staff/lessons/meta'), staleTime: 60_000 });
}

export function useLessonPages(filters: { section: string; q: string }) {
  return useInfiniteQuery({
    queryKey: lessonKeys.list(filters),
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        ...(filters.section ? { section: filters.section } : {}),
        ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return apiClient.get<LessonPage>(`/staff/lessons?${qs}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
}

type OneLesson = { lesson: Lesson };
const fetchLesson = (id: string) => apiClient.get<OneLesson>(`/staff/lessons/${id}`).then((r) => r.lesson);

export function useLesson(id: string) {
  return useQuery({ queryKey: lessonKeys.one(id), queryFn: () => fetchLesson(id) });
}

export function useLessonProgress(id: string, enabled: boolean) {
  return useQuery({
    queryKey: lessonKeys.progress(id),
    queryFn: () => apiClient.get<{ people: LessonProgressPerson[] }>(`/staff/lessons/${id}/progress`).then((r) => r.people),
    enabled,
  });
}

/** After any change: show the server's answer here, and reload the lists. */
function useApply() {
  const queryClient = useQueryClient();
  return (lesson: Lesson) => {
    queryClient.setQueryData(lessonKeys.one(lesson.id), lesson);
    void queryClient.invalidateQueries({ queryKey: lessonKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: lessonKeys.progress(lesson.id) });
  };
}

export function useCreateLesson() {
  const apply = useApply();
  return useMutation({
    mutationFn: (draft: LessonDraft) => apiClient.post<OneLesson>('/staff/lessons', draft).then((r) => r.lesson),
    onSuccess: apply,
  });
}

export function useUpdateLesson(id: string) {
  const apply = useApply();
  return useMutation({
    mutationFn: (changes: Partial<LessonDraft> & { rev: number }) => apiClient.patch<OneLesson>(`/staff/lessons/${id}`, changes).then((r) => r.lesson),
    onSuccess: apply,
  });
}

export function useLessonChecked(id: string) {
  const apply = useApply();
  return useMutation({
    mutationFn: () => apiClient.post<OneLesson>(`/staff/lessons/${id}/checked`, {}).then((r) => r.lesson),
    onSuccess: apply,
  });
}

export function useLessonDone(id: string) {
  const apply = useApply();
  return useMutation({
    mutationFn: (done: boolean) => apiClient.put<OneLesson>(`/staff/lessons/${id}/done`, { done }).then((r) => r.lesson),
    onSuccess: apply,
  });
}

export function useArchiveLesson(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete<{ archived: boolean }>(`/staff/lessons/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: lessonKeys.lists() }); },
  });
}

export function useRemoveLessonFile(id: string) {
  const apply = useApply();
  return useMutation({
    mutationFn: (fileName: string) => apiClient.delete<OneLesson>(`/staff/lessons/${id}/files/${encodeURIComponent(fileName)}`).then((r) => r.lesson),
    onSuccess: apply,
  });
}

function putFile(file: File, url: string, type: string, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // Must match what the link was signed with.
    xhr.setRequestHeader('Content-Type', type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('upload')));
    xhr.onerror = () => reject(new Error('upload'));
    xhr.send(file);
  });
}

/** Browser → private storage, then the server checks what actually arrived. */
export function useAddLessonFile(id: string) {
  const apply = useApply();
  return useMutation({
    mutationFn: async ({ file, onProgress }: { file: File; onProgress: (pct: number) => void }) => {
      const contentType = lessonFileType(file.name);
      const target = await apiClient.post<{ uploadUrl: string; key: string; contentType: string }>(
        `/staff/lessons/${id}/upload-target`, { contentType, size: file.size },
      );
      await putFile(file, target.uploadUrl, target.contentType, onProgress);
      return apiClient.post<OneLesson>(`/staff/lessons/${id}/files`, { key: target.key, name: file.name }).then((r) => r.lesson);
    },
    onSuccess: apply,
  });
}

/** A short-lived private link: fetched when it is needed, never kept. */
export const lessonFileLink = (id: string, fileName: string) =>
  apiClient.get<{ url: string }>(`/staff/lessons/${id}/files/${encodeURIComponent(fileName)}`).then((r) => r.url);
