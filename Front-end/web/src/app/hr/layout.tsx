/**
 * HR panel layout — server component.
 *
 * Re-reads the session from the backend (/auth/me: signature, sessionVersion,
 * role and staff team from the database) before any panel HTML is sent. The HR
 * API enforces the same rule on every route (middleware/hrAuth.js); this layer
 * just keeps people who would get 403s everywhere out of an empty shell.
 *
 * SEO: private. noindex here, '/hr' in robots.ts DISALLOW, never in sitemap.ts.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { fetchMe } from '@/app/team/staffSession';
import { hrAccessFor } from '@/lib/hr/access';
import HrLayoutClient from '@/components/hr/HrLayoutClient';
import HrNoAccess from '@/components/hr/HrNoAccess';

export const metadata: Metadata = {
  title: 'HR Panel | Autobacs India',
  robots: { index: false, follow: false, nocache: true },
};

export default async function HrLayout({ children }: { children: ReactNode }) {
  const me = await fetchMe();
  const user = me?.success ? me.user ?? null : null;
  const access = hrAccessFor(user);
  // redirect() throws by design, so it stays outside any try.
  if (access === 'signin') redirect('/login?redirect=/hr');
  if (access === 'denied') return <HrNoAccess />;

  return (
    <HrLayoutClient userName={user?.name || user?.email || 'HR'} isAdmin={user?.role === 'admin'}>
      {children}
    </HrLayoutClient>
  );
}
