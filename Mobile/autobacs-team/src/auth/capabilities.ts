/**
 * What this login may do in the app (GET /hr/me/app). Decides only what the
 * app SHOWS — every approval is still checked by the server on its own.
 * Fails closed: an error or an older server means "no Approvals tab".
 */
import { useQuery } from '@tanstack/react-query';
import { api, type AppCapabilities } from '../api';
import { NO_CAPS } from '../lib/approvals';

export { canApproveAnything, NO_CAPS } from '../lib/approvals';

export const CAPS_KEY = ['caps'] as const;

export function useCapabilities(): AppCapabilities {
  const q = useQuery({ queryKey: CAPS_KEY, queryFn: () => api.capabilities(), staleTime: 10 * 60_000, retry: 1 });
  return q.data ?? NO_CAPS;
}
