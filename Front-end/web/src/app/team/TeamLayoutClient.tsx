'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, KeyRound, Banknote, PlusCircle, ReceiptText, FileText, BadgeCheck, PackageCheck, PackageSearch, PhoneCall, Wallet, Truck, MessagesSquare, Landmark, Factory, ListTodo, LifeBuoy, History } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useChatUnreadTotal } from '@/hooks/queries/useTeamChat';
import NotificationBell from '@/components/notifications/NotificationBell';
import PanelShell from '@/components/panel/PanelShell';
import ViewWebsiteLink from '@/components/panel/ViewWebsiteLink';
import { MARKETING_BASE } from '@/lib/usePanel';
import { MARKETING_AREAS } from './marketingAreas';

type NavItem = { href: string; label: string; icon: LucideIcon };

/** Links per team. The API enforces the same split; this only hides what would 403. */
const PASSWORD_PATH = '/team/password';

function navFor(team: string, isHead: boolean, canSell: boolean): NavItem[] {
  const nav: NavItem[] = [
    { href: '/team', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/team/chat', label: 'Team chat', icon: MessagesSquare },
    // Every team: heads give tasks to their team, members keep their own.
    { href: '/team/tasks', label: 'Tasks', icon: ListTodo },
  ];
  /*
    The paid list, split in two so "what still needs doing" is not buried under
    everything ever sold. Both go to every team that had the single list before,
    so nobody loses sight of an order — it just moves across once delivered.
  */
  const paid: NavItem = { href: '/team/orders', label: 'Order processing', icon: BadgeCheck };
  const delivered: NavItem = { href: '/team/orders/delivered', label: 'Delivered', icon: PackageCheck };
  // GTM: the head and leads sell; executives and customer support have no tools yet.
  if (team === 'sales' && canSell) {
    nav.push(
      { href: '/team/sales/new', label: 'New quotation', icon: PlusCircle },
      { href: '/team/sales/pay-first', label: 'Payment first', icon: Banknote },
      { href: '/team/sales/quotations', label: 'Quotations', icon: FileText },
      { href: '/team/sales', label: isHead ? 'Team orders' : 'My orders', icon: ReceiptText },
      { href: '/team/decisions', label: 'Customer decisions', icon: PhoneCall },
    );
    if (isHead) nav.push(paid, delivered);
  }
  if (team === 'procurement') nav.push({ href: '/team/procurement', label: 'Orders', icon: PackageSearch }, paid, delivered);
  if (team === 'accounts') nav.push({ href: '/team/refunds', label: 'Refund approvals', icon: Wallet }, paid, delivered);
  if (team === 'operations') nav.push({ href: '/team/deliveries', label: 'Deliveries', icon: Truck }, paid, delivered);
  if (team === 'marketing') nav.push(...MARKETING_AREAS.map(({ href, label, icon }) => ({ href, label, icon })));
  /*
    Payment requests: supplier payments (procurement), expenses (EVERY team —
    anyone can need fuel, a courier or a tool), and approving them (accounts).
    No list here: the API decides what each person may raise and see, and
    hiding the menu from a team that is allowed to claim is how GTM ended up
    paying its own fuel.
  */
  // Bank transfers on sales orders: accounts confirms them, GTM follows its own.
  if (team === 'accounts' || (team === 'sales' && canSell)) nav.push({ href: '/team/bank-transfers', label: 'Bank transfers', icon: Landmark });
  // Sales made before the website: GTM enters its own, accounts corrects and deletes.
  if (team === 'accounts' || (team === 'sales' && canSell)) nav.push({ href: '/team/past-sales', label: 'Past sales', icon: History });
  nav.push({ href: '/team/payments', label: 'Payments', icon: Banknote });
  if (team === 'procurement' || team === 'accounts') nav.push({ href: '/team/suppliers', label: 'Suppliers', icon: Factory });
  nav.push({ href: '/team/members', label: 'My team', icon: Users });
  // Every team: how to use the panel (lib/help/teamFaq.ts).
  nav.push({ href: '/team/help', label: 'Help', icon: LifeBuoy });
  return nav;
}

/** Staff panel shell: sidebar on desktop, a menu button that slides it in on phones. */
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

  const items = navFor(team, isHead, canSell).map(({ href, label, icon }) => ({
    href,
    label,
    icon,
    // Marketing screens and tasks have detail pages (a coupon, a campaign, one task) under them.
    active: pathname === href
      || ((href.startsWith(`${MARKETING_BASE}/`) || href === '/team/tasks') && pathname.startsWith(`${href}/`)),
    count: href === '/team/chat' ? unread : undefined,
  }));
  const current = items.find((i) => i.active);

  return (
    <PanelShell
      homeHref="/team"
      subtitle={`${teamLabel} Team`}
      sections={[{ items }]}
      user={{ name: userName, role: roleLabel || (isHead ? 'Team head' : 'Team member') }}
      footer={canChangePassword && (
        <Link href={PASSWORD_PATH} className="pn-side-link inline-flex items-center gap-1.5 text-xs">
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Change password
        </Link>
      )}
      onLogout={signOut}
      heading={<h2 className="pn-title truncate text-lg text-gray-900 md:text-xl">{current?.label || `${teamLabel} Team`}</h2>}
      // Everything waiting on this team in one place — approvals, refunds,
      // unread chat — so nobody opens each page to check. Every team gets the
      // website one click away, to check a product or a price as a customer sees it.
      actions={(
        <>
          <ViewWebsiteLink />
          <NotificationBell chatHref="/team/chat" />
        </>
      )}
    >
      {children}
    </PanelShell>
  );
}
