/**
 * Staff panel layout — server component.
 *
 * Re-verifies the session with the backend (/auth/me: signature, sessionVersion,
 * role and staff status read from the database) before any panel HTML is sent.
 * middleware.ts is only the fast pre-filter, and the /staff API enforces team
 * scope on every call; this is the layer that stops a stale or forged token from
 * rendering the shell.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import TeamLayoutClient from './TeamLayoutClient';

export const metadata: Metadata = {
  title: 'Team Panel | Autobacs India',
  robots: { index: false, follow: false, nocache: true },
};

type MeResponse = {
  success?: boolean;
  user?: {
    id: string;
    name?: string;
    email?: string;
    role?: string;
    staff?: { team: string; teamLabel: string; isHead: boolean } | null;
  };
};

async function fetchMe(): Promise<MeResponse | null> {
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
}

export default async function TeamLayout({ children }: { children: ReactNode }) {
  // redirect() throws by design, so every decision is made outside the try above.
  const me = await fetchMe();
  if (!me?.success || !me.user) redirect('/login?redirect=/team');

  const { user } = me;
  // Admins manage teams from the admin area; they have no team of their own.
  if (user.role === 'admin') redirect('/admin/staff');
  if (user.role !== 'staff' || !user.staff) redirect('/');

  return (
    <TeamLayoutClient
      userName={user.name || user.email || 'Team member'}
      team={user.staff.team}
      teamLabel={user.staff.teamLabel}
      isHead={user.staff.isHead}
    >
      {children}
    </TeamLayoutClient>
  );
}
