/**
 * Marketing panel — the marketing team's copies of the admin marketing screens.
 *
 * The pages under here re-export the admin pages; `usePanel()` (lib/usePanel)
 * rebases their links onto /team/marketing and hides admin-only controls. The
 * API (adminOrMarketing) is the real gate; this layout just keeps other teams
 * from opening screens that would 403 on every call.
 */

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { fetchMe } from '../staffSession';

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const me = await fetchMe();
  // The parent /team layout already redirected anyone signed out or not staff.
  if (me?.user?.staff?.team !== 'marketing') redirect('/team');
  return children;
}
