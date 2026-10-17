'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, LogOut, KeyRound, Banknote, PlusCircle, ReceiptText, FileText, BadgeCheck, PackageSearch, PhoneCall, Wallet, Truck, MessagesSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useChatUnreadTotal } from '@/hooks/queries/useTeamChat';
import { MARKETING_BASE } from '@/lib/usePanel';
import { MARKETING_AREAS } from './marketingAreas';

type NavItem = { href: string; label: string; icon: LucideIcon };

/** Links per team. The API enforces the same split; this only hides what would 403. */
const PASSWORD_PATH = '/team/password';

function navFor(team: string, isHead: boolean, canSell: boolean): NavItem[] {
  const nav: NavItem[] = [
    { href: '/team', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/team/chat', label: 'Team chat', icon: MessagesSquare },
  ];
  const paid: NavItem = { href: '/team/orders', label: 'Paid orders', icon: BadgeCheck };
  // GTM: the head and leads sell; executives and customer support have no tools yet.
  if (team === 'sales' && canSell) {
    nav.push(
      { href: '/team/sales/new', label: 'New quotation', icon: PlusCircle },
      { href: '/team/sales/quotations', label: 'Quotations', icon: FileText },
      { href: '/team/sales', label: isHead ? 'Team orders' : 'My orders', icon: ReceiptText },
      { href: '/team/decisions', label: 'Customer decisions', icon: PhoneCall },
    );
    if (isHead) nav.push(paid);
  }
  if (team === 'procurement') nav.push({ href: '/team/procurement', label: 'Stock & shipping', icon: PackageSearch }, paid);
  if (team === 'accounts') nav.push({ href: '/team/refunds', label: 'Refund approvals', icon: Wallet }, paid);
  if (team === 'operations') nav.push({ href: '/team/deliveries', label: 'Deliveries', icon: Truck }, paid);
  if (team === 'marketing') nav.push(...MARKETING_AREAS.map(({ href, label, icon }) => ({ href, label, icon })));
  // Payment requests: supplier payments (procurement), expenses (operations,
  // marketing), and paying them (accounts).
  if (['procurement', 'accounts', 'operations', 'marketing'].includes(team)) {
    nav.push({ href: '/team/payments', label: 'Payments', icon: Banknote });
  }
  nav.push({ href: '/team/members', label: 'My team', icon: Users });
  return nav;
}

/** Staff panel shell: sidebar on desktop, top bar on phones. */
export default function TeamLayoutClient({
  userName,
  team,
  teamLabel,
  isHead,
  roleLabel,
  canSell = false,
  canChangePassword = true,
  children,
}: {
  userName: string;
  team: string;
  teamLabel: string;
  isHead: boolean;
  /** "GTM head", "GTM lead", "Procurement head", "Member"… */
  roleLabel?: string;
  /** GTM head and leads: the selling tools in the menu. */
  canSell?: boolean;
  /** False for company accounts: their password is managed by the admin. */
  canChangePassword?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const unread = useChatUnreadTotal();
  const signOut = async () => {
    await logout();
    router.push('/login');
  };

  const links = navFor(team, isHead, canSell).map(({ href, label, icon: Icon }) => {
    // Marketing screens have detail pages (a coupon, a campaign) under them.
    const active = pathname === href || (href.startsWith(`${MARKETING_BASE}/`) && pathname.startsWith(`${href}/`));
    return (
      <Link
        key={href}
        href={href}
        className={`flex items-center gap-3 shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" /> {label}
        {href === '/team/chat' && unread > 0 && (
          <span className="ml-auto rounded-full bg-emerald-500 px-1.5 text-xs font-bold leading-5 text-white" aria-label={`${unread} unread`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    );
  });

  return (
    <div className="admin-panel min-h-screen bg-gray-50 md:flex">
      <aside className="bg-gray-900 text-white md:fixed md:inset-y-0 md:flex md:w-60 md:flex-col">
        <div className="flex items-center justify-between border-b border-gray-800 p-4 md:block">
          <div>
            <p className="text-lg font-bold">{teamLabel} Team</p>
            <p className="text-xs text-gray-400">{roleLabel || (isHead ? 'Team head' : 'Team member')}</p>
          </div>
          <button onClick={signOut} className="rounded-lg bg-red-600 p-2 text-sm md:hidden" aria-label="Log out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex gap-2 overflow-x-auto p-3 md:flex-1 md:flex-col">{links}</nav>
        <div className="hidden border-t border-gray-800 p-4 md:block">
          <p className="text-xs text-gray-400">Logged in as</p>
          <p className="truncate text-sm font-medium">{userName}</p>
          {canChangePassword && (
            <Link href={PASSWORD_PATH} className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-300 hover:text-white">
              <KeyRound className="h-3.5 w-3.5" /> Change password
            </Link>
          )}
          <button
            onClick={signOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 p-2 text-sm hover:bg-red-700"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:ml-60 md:p-8">{children}</main>
    </div>
  );
}
