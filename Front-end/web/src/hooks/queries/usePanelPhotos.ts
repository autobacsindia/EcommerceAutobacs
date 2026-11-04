'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { profileKeys } from './keys';

const EMPTY: Readonly<Record<string, string>> = Object.freeze({});

/**
 * { userId: photoUrl } for everyone in the panels (GET /staff/photos). Tasks carry
 * names, not photos, so their faces look the photo up here by id. One small,
 * shared request; a failure just means initials everywhere.
 */
export function usePanelPhotos(): Readonly<Record<string, string>> {
  const { data } = useQuery({
    queryKey: profileKeys.panelPhotos(),
    queryFn: async () => (await apiClient.get<{ photos?: Record<string, string> }>('/staff/photos'))?.photos ?? EMPTY,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data ?? EMPTY;
}
