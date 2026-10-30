'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { postForm } from '@/lib/postForm';
import { staffKeys } from '@/hooks/queries/keys';
import type { ReturnDetail } from './types';

type Res = { success: boolean; return: ReturnDetail };

/**
 * Run one action on a return (JSON, or multipart when files are attached). On success
 * the open panel shows the server's new state and every return list refreshes.
 */
export function useReturnAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body, files }: { path: string; body?: Record<string, unknown>; files?: File[] }) => {
      if (files) {
        const form = new FormData();
        for (const [k, v] of Object.entries(body || {})) {
          if (v === undefined || v === null) continue;
          form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        }
        files.forEach((f) => form.append('photo', f));
        return postForm<Res>(`/staff/returns/${id}${path}`, form);
      }
      return apiClient.post<Res>(`/staff/returns/${id}${path}`, body || {});
    },
    onSuccess: (res) => {
      if (res?.return) qc.setQueryData(staffKeys.returnOne(id), res);
      qc.invalidateQueries({ queryKey: staffKeys.returns() });
    },
  });
}
