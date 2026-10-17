/**
 * What is waiting on the signed-in person, for the header bell.
 *
 * Polled rather than streamed. The chat page already holds the one live
 * connection a tab is allowed, and these counts are a handful of integers that
 * change a few times an hour — a second long-lived connection per tab to carry
 * them would cost more than it saves. The interval is short enough that nobody
 * sits on stale work, and polling stops while the tab is hidden so a laptop
 * full of forgotten tabs is not quietly hammering the API all night.
 */
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { notificationKeys } from './keys';
import { useAuth } from '@/context/AuthContext';

export interface WaitingItem {
  key: string;
  label: string;
  count: number;
  href: string;
}

const POLL_MS = 20_000;

export function useWaitingWork() {
  const { user } = useAuth();
  const enabled = !!user && (user.role === 'admin' || (user.role === 'staff' && !!user.staff));

  return useQuery({
    queryKey: notificationKeys.summary(),
    queryFn: async () => {
      const res = await apiClient.get<{ items: WaitingItem[]; total: number }>('/notifications/summary');
      return { items: res.items ?? [], total: res.total ?? 0 };
    },
    enabled,
    staleTime: 10_000,
    refetchInterval: POLL_MS,
    // A hidden tab is not being read, so it does not need fresh counts; it
    // refetches the moment it comes back to the front.
    refetchIntervalInBackground: false,
  });
}
