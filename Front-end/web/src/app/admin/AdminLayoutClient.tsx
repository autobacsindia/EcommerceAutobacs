'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  BellRing, Briefcase, Building2, Car, ChartLine, CreditCard, Factory, FerrisWheel, FolderTree, Gift, Globe,
  GraduationCap, HandCoins, Handshake, History, Hourglass, IdCard, Images, Inbox, Landmark, LayoutDashboard, ListTodo, Megaphone,
  MessagesSquare, Package, ShoppingBag, Sparkles, SquarePen, Star, Tag, Target, TicketPercent, Timer, Undo2, UserRoundCog,
  Users, Wallet, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PanelShell from '@/components/panel/PanelShell';
import { useAdminStats } from '@/hooks/queries/useAdminStats';
import { formatCurrency } from '@/lib/utils';
import { useChatUnreadTotal } from '@/hooks/queries/useTeamChat';
import NotificationBell from '@/components/notifications/NotificationBell';
import ViewWebsiteLink from '@/components/panel/ViewWebsiteLink';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Main',
    items: [
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/admin/overview', label: 'Company overview', icon: Building2 },
      { href: '/admin/chat', label: 'Team Chat', icon: MessagesSquare },
      { href: '/admin/tasks', label: 'Tasks', icon: ListTodo },
      { href: '/admin/analytics', label: 'Analytics', icon: ChartLine },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { href: '/admin/products', label: 'Products', icon: ShoppingBag },
      { href: '/admin/brands', label: 'Brands', icon: Tag },
      { href: '/admin/categories', label: 'Categories', icon: FolderTree },
      { href: '/admin/vehicles', label: 'Vehicles', icon: Car },
      { href: '/admin/coupons', label: 'Coupons', icon: TicketPercent },
      { href: '/admin/campaigns', label: 'Campaigns', icon: Gift },
      { href: '/admin/loyalty', label: 'Karma Points', icon: Sparkles },
      { href: '/admin/stock-requests', label: 'Stock Requests', icon: BellRing },
    ],
  },
  {
    title: 'Orders',
    items: [
      { href: '/admin/orders', label: 'Orders', icon: Package },
      { href: '/admin/returns', label: 'Returns', icon: Undo2 },
      { href: '/admin/refunds', label: 'Refunds', icon: HandCoins },
      { href: '/admin/spin', label: 'Spin to Win', icon: FerrisWheel },
      /*
        There is deliberately NO "Goodies to pack" entry here.

        A won goodie is a fulfilment unit: an order cannot reach `delivered` until the
        gift is in a parcel (utils/orderFulfilment.js), so an order that still owes one
        simply stays open in the ordinary Orders queue. A separate nav item would be a
        second place to look for work that the Orders screen already surfaces — via the
        🎁 filter and the per-row chip — and a second list to forget to check.
      */
    ],
  },
  // Inventory (Warehouses) — feature is fully implemented (frontend + backend
  // /api/v1/warehouses, models, tests) but hidden from the admin nav for now.
  // To re-enable, uncomment this section; the /admin/warehouses route still works.
  // {
  //   title: 'Inventory',
  //   items: [
  //     { href: '/admin/warehouses', label: 'Warehouses', icon: Warehouse },
  //   ],
  // },
  {
    title: 'Support',
    items: [
      { href: '/admin/support', label: 'Inbox', icon: Inbox },
    ],
  },
  {
    title: 'Sales',
    items: [
      { href: '/admin/leads', label: 'Leads', icon: Briefcase },
      { href: '/admin/sales-reps', label: 'Sales Reps', icon: UserRoundCog },
      { href: '/admin/past-sales', label: 'Past sales', icon: History },
      { href: '/admin/affiliates', label: 'Affiliates', icon: Handshake },
      // Listed BEFORE the batches screen: "who is due" is the question you start from,
    // "what have we already built" is the follow-up.
      { href: '/admin/affiliates/payout-queue', label: 'Payout Queue', icon: Hourglass },
      { href: '/admin/affiliates/payouts', label: 'Affiliate Payouts', icon: Wallet },
      { href: '/admin/users', label: 'Users', icon: Users },
      { href: '/admin/reviews', label: 'Reviews', icon: Star },
      { href: '/admin/consultation', label: 'Consultancy', icon: Target },
    ],
  },
  {
    title: 'Content',
    items: [
      { href: '/admin/blog', label: 'Blog', icon: SquarePen },
      { href: '/admin/promo-banners', label: 'Promo Banner', icon: Megaphone },
      { href: '/admin/media', label: 'Media', icon: Images },
      { href: '/admin/careers', label: 'Careers', icon: GraduationCap },
      { href: '/admin/seo', label: 'Pages SEO', icon: Globe },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/admin/staff', label: 'Staff & Teams', icon: IdCard },
      { href: '/admin/team-activity', label: 'Team activity', icon: Timer },
      { href: '/admin/pop-ups', label: 'Pop-up check', icon: BellRing },
      { href: '/admin/payments', label: 'Payments', icon: CreditCard },
      { href: '/admin/suppliers', label: 'Suppliers', icon: Factory },
      { href: '/admin/bank-transfers', label: 'Bank transfers', icon: Landmark },
      { href: '/admin/workflows', label: 'Workflows', icon: Zap },
    ],
  },
];

interface AdminLayoutClientProps {
  children: React.ReactNode;
  userName: string;
}

export default function AdminLayoutClient({ children, userName }: AdminLayoutClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Derive collapse state from the section list itself so it never drifts from NAV_SECTIONS
  // (previously hardcoded — carried a stale 'Finance' key that matched no section).
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      NAV_SECTIONS.filter((s) => s.title !== 'Main').map((s) => [s.title, false])
    )
  );
  // Header counters. Polled + cached by TanStack Query (see useAdminStats).
  const { stats, isError: statsFailed } = useAdminStats();
  const chatUnread = useChatUnreadTotal();

  // Deep-link each counter to the Orders view it summarises, carrying the exact
  // status group (and, for revenue, the exact date window) the backend counted —
  // so the list can never disagree with the number above it. The fallbacks only
  // apply to a cached pre-`filters` API response.
  const ordersHref = (statuses: string[] | undefined, fallback: string, startDate?: string) => {
    const params = new URLSearchParams({ status: statuses?.length ? statuses.join(',') : fallback });
    if (startDate) params.set('startDate', startDate);
    return `/admin/orders?${params.toString()}`;
  };

  const navSections = NAV_SECTIONS;

  // The ONE nav item for the current page: the longest href that equals the path or is
  // a parent of it. A plain prefix test lit several at once — `/admin/affiliates/payouts`
  // also lit "Affiliates", and `/admin` (Dashboard) prefixes every admin page — while
  // still needing parent matching so a detail page (`/admin/orders/123`) lights "Orders".
  const activeHref = NAV_SECTIONS
    .flatMap(section => section.items.map(item => item.href))
    .filter((href): href is string =>
      !!href && (pathname === href || pathname.startsWith(href + '/')))
    .reduce<string | null>((best, href) => (!best || href.length > best.length ? href : best), null);

  // Auto-expand the section that contains the current page; collapse everything else
  useEffect(() => {
    const updates: Record<string, boolean> = {};
    NAV_SECTIONS.forEach(section => {
      const hasActive = section.items.some(item => item.href === activeHref);
      // Only flip sections that are collapsible (not 'Main')
      if (section.title !== 'Main') {
        updates[section.title] = hasActive;
      }
    });
    setExpandedSections(updates);
  }, [activeHref]);

  const toggleSection = (title: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [title]: !prev[title]
    }));
  };

  const isLinkActive = (href?: string) => !!href && href === activeHref;

  const handleLogout = async () => {
    try {
      const xsrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('XSRF-TOKEN='))
        ?.split('=')[1];
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: xsrfToken ? { 'X-XSRF-TOKEN': xsrfToken } : {},
      });
      router.push('/login');
    } catch (error) {
      console.error('[Admin] Logout failed:', error);
    }
  };

  const sections = navSections.map((section) => ({
    // "Main" is always open: it holds the dashboard, chat and tasks.
    title: section.title === 'Main' ? undefined : section.title,
    expanded: !!expandedSections[section.title],
    onToggle: () => toggleSection(section.title),
    items: section.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      active: isLinkActive(item.href),
      count: item.href === '/admin/chat' ? chatUnread : undefined,
    })),
  }));

  const pageLabel = navSections.flatMap((s) => s.items).find((link) => link.href === activeHref)?.label;

  return (
    <PanelShell
      homeHref="/admin"
      subtitle="Admin panel"
      sections={sections}
      collapsed={!sidebarOpen}
      onToggleCollapsed={() => setSidebarOpen(!sidebarOpen)}
      user={{ name: userName, role: 'Admin' }}
      onLogout={handleLogout}
      heading={<h2 className="pn-title truncate text-lg text-gray-900 md:text-xl">{pageLabel || 'Admin'}</h2>}
      actions={
        <>
          {/* Stats Overview — each tile drills into the orders behind the number */}
          <Link
            href={ordersHref(stats.filters?.pendingOrders, 'processing,shipped')}
            title="Orders placed but not delivered yet"
            className="hidden rounded-lg px-2.5 py-1 text-right transition-colors hover:bg-gray-100 sm:block"
          >
            <p className="text-xs text-gray-500">Pending orders</p>
            <p className="text-base font-bold tabular-nums text-amber-700">
              {statsFailed ? '—' : stats.pendingOrders.toLocaleString('en-IN')}
            </p>
          </Link>
          <Link
            href={ordersHref(
              stats.filters?.totalRevenue,
              'processing,shipped,delivered',
              stats.revenuePeriod?.startDate
            )}
            title={`Realised revenue since ${stats.revenuePeriod?.startDate ?? 'the start of the financial year'} — excludes cancelled, returned and abandoned orders`}
            className="hidden rounded-lg px-2.5 py-1 text-right transition-colors hover:bg-gray-100 sm:block"
          >
            <p className="text-xs text-gray-500">
              Revenue{stats.revenuePeriod ? ` (${stats.revenuePeriod.label})` : ''}
            </p>
            <p className="text-base font-bold tabular-nums text-green-700">
              {statsFailed ? '—' : formatCurrency(stats.totalRevenue)}
            </p>
          </Link>
          <span className="mx-1 hidden h-8 w-px bg-gray-200 sm:block" aria-hidden="true" />
          <ViewWebsiteLink />
          {/* Chat has its own button so it is one click from anywhere in admin. */}
          <Link
            href="/admin/chat"
            aria-current={isLinkActive('/admin/chat') ? 'page' : undefined}
            className={`relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isLinkActive('/admin/chat') ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
            }`}
          >
            <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Chat
            {chatUnread > 0 && (
              <span className="rounded-full bg-blue-600 px-1.5 text-xs font-bold leading-5 text-white" aria-label={`${chatUnread} unread`}>
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
          </Link>
          {/* One glance for everything else that is waiting — approvals,
              refunds — so nobody has to open each section to find out. */}
          <NotificationBell chatHref="/admin/chat" />
        </>
      }
    >
      {children}
    </PanelShell>
  );
}
