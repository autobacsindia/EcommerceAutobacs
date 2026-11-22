'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck, CalendarDays, IndianRupee, MapPin, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PanelShell from '@/components/panel/PanelShell';
import ViewWebsiteLink from '@/components/panel/ViewWebsiteLink';
import { hrApi } from '@/lib/hr/api';
import { hrKeys } from '@/lib/hr/keys';

type NavItem = { href: string; label: string; icon: LucideIcon };

export const HR_NAV: readonly NavItem[] = [
  { href: '/hr', label: "Today's attendance", icon: CalendarCheck },
  { href: '/hr/employees', label: 'Employees', icon: Users },
  { href: '/hr/leave', label: 'Leave requests', icon: CalendarDays },
  { href: '/hr/payroll', label: 'Payroll', icon: IndianRupee },
  { href: '/hr/settings', label: 'Work sites & settings', icon: MapPin },
];

const isActive = (pathname: string, href: string) =>
  href === '/hr' ? pathname === '/hr' : pathname === href || pathname.startsWith(`${href}/`);

/** The HR panel frame: the same shell (sidebar, top bar) as the staff and admin panels. */
export default function HrLayoutClient({
  userName, isAdmin, children,
}: { userName: string; isAdmin: boolean; children: ReactNode }) {
  const pathname = usePathname() || '/hr';
  const router = useRouter();
  const { logout, user } = useAuth();

  // The "waiting" badge on Leave requests. A first page is enough to say "25+";
  // an undeployed endpoint just shows no badge.
  const inbox = useQuery({ queryKey: hrKeys.leaveInbox(), queryFn: () => hrApi.leaveInbox(), retry: false });
  const waiting = inbox.data ? inbox.data.items.length : undefined;

  const items = HR_NAV.map(({ href, label, icon }) => ({
    href, label, icon,
    active: isActive(pathname, href),
    count: href === '/hr/leave' && waiting ? waiting : undefined,
  }));
  const current = items.find((i) => i.active);
  const backHref = isAdmin ? '/admin' : '/team';

  return (
    <PanelShell
      homeHref="/hr"
      subtitle="HR panel"
      sections={[{ items }]}
      user={{ name: user?.name || userName, photoUrl: user?.avatarUrl, role: isAdmin ? 'Admin' : 'HR team' }}
      footer={(
        <Link href={backHref} className="pn-side-link inline-flex items-center gap-1.5 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {isAdmin ? 'Back to admin' : 'Back to team panel'}
        </Link>
      )}
      onLogout={async () => { await logout(); router.push('/login'); }}
      hoverRail
      heading={<h2 className="pn-title truncate text-lg text-gray-900 md:text-xl">{current?.label || 'HR'}</h2>}
      actions={<ViewWebsiteLink />}
    >
      {children}
    </PanelShell>
  );
}
