'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { loginHref } from '@/lib/utils';

/**
 * The auth gate for a signed-in-only storefront page (profile, orders, wishlist).
 *
 * Two things it fixes over the copy-pasted `if (!isAuthenticated) router.push('/login')`
 * effect it replaces:
 *
 *  1. **It carries the destination.** A customer who taps the profile icon while signed
 *     out used to land on /login and then get dropped at the home page — nowhere near
 *     the account they were reaching for. The bounce now becomes
 *     `/login?redirect=/profile`, which the login page already honours (sanitised
 *     through `safeInternalPath`, so the round-trip can't be turned into an open
 *     redirect by editing the URL).
 *
 *  2. **`replace`, not `push`.** With `push`, the protected page stays in history: Back
 *     from /login returns to it, the guard fires again, and the customer is thrown
 *     forward to /login a second time — a page they cannot escape backwards.
 *
 * `releaseGuard()` exists for the one case where leaving is *intentional*: signing out
 * from /profile. Clearing the user trips this guard in the same render, so without the
 * release the deliberate "go home" navigation races the bounce and the customer lands
 * on the login screen anyway. Call it before `logout()`, then navigate.
 *
 * The current query string is read from `window.location` inside the effect rather than
 * via `useSearchParams()` on purpose: this hook is mounted by pages that are not all
 * opted into dynamic rendering, and `useSearchParams()` would demand a Suspense
 * boundary around each of them at build time. The effect is client-only, so
 * `window` is always there by the time it runs.
 */
export function useRequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const released = useRef(false);

  const releaseGuard = useCallback(() => {
    released.current = true;
  }, []);

  useEffect(() => {
    if (released.current) return;
    if (isLoading || isAuthenticated) return;
    const search = typeof window !== 'undefined' ? window.location.search : '';
    router.replace(loginHref(`${pathname ?? '/'}${search}`));
  }, [isAuthenticated, isLoading, pathname, router]);

  return { isAuthenticated, isLoading, releaseGuard };
}

export default useRequireAuth;
