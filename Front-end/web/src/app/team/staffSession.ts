/**
 * The signed-in staff member, re-read from the backend (/auth/me: signature,
 * sessionVersion, role and staff status from the database). Shared by the /team
 * layout and the per-team layouts under it. Server-only.
 */

import { cache } from 'react';
import { cookies } from 'next/headers';

export type MeResponse = {
  success?: boolean;
  user?: {
    id: string;
    name?: string;
    email?: string;
    role?: string;
    staff?: { team: string; teamLabel: string; isHead: boolean; roleLabel?: string | null; canSell?: boolean } | null;
    /** Set on company accounts (config/staff.js on the API), whose password the admin manages. */
    username?: string | null;
  };
};

/** Wrapped in React `cache()`, so nested layouts share one /auth/me call per request. */
export const fetchMe = cache(async (): Promise<MeResponse | null> => {
  const cookieStore = await cookies();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/me`, {
      headers: { Cookie: cookieStore.toString(), 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as MeResponse) : null;
  } catch (error) {
    console.error(`[Team Layout] Backend auth check failed | ${error instanceof Error ? error.message : 'Unknown'}`);
    return null;
  }
});
