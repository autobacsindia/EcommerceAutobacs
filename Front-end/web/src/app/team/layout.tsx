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
import { redirect } from 'next/navigation';
import TeamLayoutClient from './TeamLayoutClient';
import { fetchMe } from './staffSession';

export const metadata: Metadata = {
  title: 'Team Panel | Autobacs India',
  robots: { index: false, follow: false, nocache: true },
};

export default async function TeamLayout({ children }: { children: ReactNode }) {
  // redirect() throws by design, so every decision is made here, outside fetchMe's try.
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
      roleLabel={user.staff.roleLabel || (user.staff.isHead ? 'Team head' : 'Team member')}
      // Older sessions predate canSell: a sales member then was a seller.
      canSell={user.staff.canSell ?? user.staff.team === 'sales'}
      // A company account's password is the admin's to change, not the person's.
      canChangePassword={!user.username}
    >
      {children}
    </TeamLayoutClient>
  );
}
