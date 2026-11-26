/**
 * What is waiting on the signed-in person, for the header bell.
 *
 * Polled rather than streamed. The chat page already holds the one live
 * connection a tab is allowed, and these counts are a handful of integers that
 * change a few times an hour — a second long-lived connection per tab to carry
 * them would cost more than it saves. The interval is short enough that nobody
 * sits on stale work.
 *
 * It keeps polling while the tab is hidden, slower. It used to stop, which
 * meant the "new work" sound could never play for someone working in another
 * tab or app — exactly when they need it. Only staff and admins run this (a
 * handful of people), so one tiny request a minute per hidden tab is nothing;
 * browsers throttle hidden-tab timers to about once a minute anyway.
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
  /** Shown and counted on the badge, but never rings the "new work" alert (unread task updates). */
  quiet?: boolean;
}

/**
 * "You have a new task" / "Vicky added you to Vicky's Hilux": the newest unread
 * ones from the last day (services/staffTaskInboxService.js recentAlerts), for
 * the panel's pop-up card (components/notifications/NewWorkPopup.tsx).
 */
export interface WorkAlert {
  id: string;
  /** followup_due / followup_escalated: an order step due or late (services/followUp). */
  kind: 'assigned' | 'project_added' | 'followup_due' | 'followup_escalated';
  /** Who gave it. */
  by: string;
  /** "T-42 · Fit roof rack", or the project's name. */
  title: string;
  /** "due 2026-11-25", "you own it · deadline 2026-11-28", or empty. */
  text: string;
  href: string;
  at: string;
}

const POLL_MS = 20_000;
export const HIDDEN_POLL_MS = 60_000;

/** Visible tab: every 20 s. Hidden tab: every minute (re-read after each fetch). */
export const pollInterval = (visibleMs: number) => () =>
  (typeof document !== 'undefined' && document.visibilityState === 'hidden' ? HIDDEN_POLL_MS : visibleMs);

export function useWaitingWork() {
  const { user } = useAuth();
  const enabled = !!user && (user.role === 'admin' || (user.role === 'staff' && !!user.staff));

  return useQuery({
    queryKey: notificationKeys.summary(),
    queryFn: async () => {
      const res = await apiClient.get<{ items: WaitingItem[]; total: number; alerts?: WorkAlert[] }>('/notifications/summary');
      return { items: res.items ?? [], total: res.total ?? 0, alerts: res.alerts ?? [] };
    },
    enabled,
    staleTime: 10_000,
    refetchInterval: pollInterval(POLL_MS),
    // A hidden tab still needs to hear about new work (see the top of the file).
    refetchIntervalInBackground: true,
  });
}
