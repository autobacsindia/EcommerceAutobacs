'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AUTH_LOGIN_EVENT, AUTH_LOGOUT_EVENT } from '@/lib/api-client';

/**
 * Keeps the client data cache honest about WHO is asking.
 *
 * TanStack keys identify a *question* ("campaign status for this slug"), not the
 * identity that asked it. Almost every key here is fine with that because the answer
 * is the same for everyone — but a per-user read (campaign eligibility, wishlist,
 * orders, addresses) has a different answer before and after a sign-in, under the
 * same key.
 *
 * Nothing used to tell the cache that identity had changed, so signing in left the
 * guest's answers in place for the rest of their staleTime: the campaign reward ribbon
 * stayed hidden after login because `eligible: false` — a true answer, asked as a guest
 * — was still fresh. Only a hard reload (a new QueryClient) showed it.
 *
 * Two events, two different responses:
 *
 *  - LOGIN → `invalidateQueries()`. Mark everything stale; anything on screen refetches
 *    at once, so the ribbon appears in the same beat as the sign-in. Data already shown
 *    stays visible while the refetch runs, so nothing blanks out.
 *
 *  - LOGOUT → `clear()`. Not merely stale — *gone*. Marking stale would leave the
 *    previous account's orders and addresses sitting in memory, and a component that
 *    mounts before the refetch lands would render them to whoever is at the keyboard
 *    next. Signing out has to actually forget.
 *
 * Mounted inside QueryProvider so every consumer gets this behaviour by construction,
 * and driven by window events rather than by reading AuthContext — the cache sits ABOVE
 * auth in the provider tree, and inverting that to subscribe to it would be the kind of
 * circular dependency that only shows up as a render loop later.
 */
export default function AuthQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const onLogin = () => {
      void queryClient.invalidateQueries();
    };
    const onLogout = () => {
      queryClient.clear();
    };

    window.addEventListener(AUTH_LOGIN_EVENT, onLogin);
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
    return () => {
      window.removeEventListener(AUTH_LOGIN_EVENT, onLogin);
      window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
    };
  }, [queryClient]);

  return null;
}
