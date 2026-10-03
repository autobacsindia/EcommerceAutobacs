import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Private invite-redemption page: never indexed (paired with the robots.ts
 * disallow), and deliberately outside the config-driven PageSeo system, which
 * manages pages we want found. Sibling layout because page.tsx is a client component.
 */
export const metadata: Metadata = {
  title: 'Activate your team access | Autobacs India',
  robots: { index: false, follow: false, nocache: true },
};

export default function StaffInviteLayout({ children }: { children: ReactNode }) {
  return children;
}
