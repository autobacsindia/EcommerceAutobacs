'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';

/**
 * Non-blocking inline prompt shown when a session expires mid-use and could not
 * be silently refreshed. Instead of hard-redirecting to /login (which yanks the
 * user off the page they were on), we keep them in place and offer to sign in
 * again — returning them to exactly where they were — or to keep browsing as a
 * guest. Rendered globally from the root layout, inside AuthProvider.
 */
export default function SessionExpiredPrompt() {
  const { sessionExpired, dismissSessionExpired } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (!sessionExpired) return null;

  const signIn = () => {
    // Preserve the current location so login returns the user to their place.
    const redirect = encodeURIComponent(pathname || '/');
    dismissSessionExpired();
    router.push(`/login?redirect=${redirect}&reason=session_expired`);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-4 rounded-lg border border-gold/30 bg-obsidian-raised px-4 py-3 shadow-lg">
        <div className="flex-1 text-sm text-ink">
          <p className="font-medium">Your session expired</p>
          <p className="text-ink/70">Sign in again to continue where you left off.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={dismissSessionExpired}>
            Dismiss
          </Button>
          <Button variant="primary" size="sm" onClick={signIn}>
            Sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
