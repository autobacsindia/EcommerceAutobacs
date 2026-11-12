'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BookOpenCheck, GraduationCap, Handshake, LayoutDashboard, Users, KeyRound, Banknote, PlusCircle, ReceiptText, FileText, BadgeCheck, PackageCheck, PackageSearch, PhoneCall, Wallet, Truck, MessagesSquare, Landmark, Factory, ListTodo, LifeBuoy, History, Undo2, Contact, Megaphone, UserMinus, Coins, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useChatUnreadTotal } from '@/hooks/queries/useTeamChat';
import NotificationBell from '@/components/notifications/NotificationBell';
import PanelShell from '@/components/panel/PanelShell';
import ViewWebsiteLink from '@/components/panel/ViewWebsiteLink';
import { splitMore } from '@/components/panel/navMore';
import { MARKETING_BASE } from '@/lib/usePanel';
import { MARKETING_AREAS } from './marketingAreas';

type NavItem = { href: string; label: string; icon: LucideIcon };

/** Links per team. The API enforces the same split; this only hides what would 403. */
const PASSWORD_PATH = '/team/password';

/**
 * Same for every team: the less-used pages fold under "More". Only moves links
 * `navFor` already allowed — who sees what is decided there, not here.
 */
export const TEAM_MORE_HREFS = [
  '/team/lessons',
  '/team/training',
  '/team/handover',
  '/team/past-members',
  '/team/sales-ratings',
  '/team/members',
  '/team/help',
] as const;

function navFor(team: string, isHead: boolean, canSell: boolean): NavItem[] {
  const nav: NavItem[] = [
    { href: '/team', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/team/chat', label: 'Team chat', icon: MessagesSquare },
    // Every team: heads give tasks to their team, members keep their own.
    { href: '/team/tasks', label: 'Tasks', icon: ListTodo },
    // Every team: training that heads and admins post.
    { href: '/team/lessons', label: 'Lessons', icon: GraduationCap },
    { href: '/team/training', label: 'Training', icon: BookOpenCheck },
    { href: '/team/handover', label: 'Handover', icon: Handshake },
    // Every team: who used to be here, and the work they did.
    { href: '/team/past-members', label: 'Past members', icon: UserMinus },
  ];
  /*
    The paid list, split in two so "what still needs doing" is not buried under
    everything ever sold. Both go to every team that had the single list before,
    so nobody loses sight of an order — it just moves across once delivered.
  */
  const paid: NavItem = { href: '/team/orders', label: 'Order processing', icon: BadgeCheck };
  const delivered: NavItem = { href: '/team/orders/delivered', label: 'Delivered', icon: PackageCheck };
  // GTM: everyone sees the leads sheet; only the head and leads take one (the API decides).
  if (team === 'sales') nav.push({ href: '/team/leads', label: 'Website leads', icon: Contact });
  // Rows from the sales lead sheet: GTM and the Marketing head (the API decides who edits).
  if (team === 'sales' || (team === 'marketing' && isHead)) nav.push({ href: '/team/meta-leads', label: 'Meta leads', icon: Megaphone });
  // GTM: the head and leads sell; executives and customer support have no other tools yet.
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
  // Procurement: one "Orders" item, with "To do" and "All in progress" tabs (the
  // latter is the "Order processing" list) — two items for one job confused people.
  if (team === 'procurement') nav.push({ href: '/team/procurement', label: 'Orders', icon: PackageSearch }, delivered);
  if (team === 'accounts') nav.push({ href: '/team/refunds', label: 'Refunds', icon: Wallet }, paid, delivered);
  if (team === 'operations') nav.push({ href: '/team/deliveries', label: 'Deliveries', icon: Truck }, paid, delivered);
  if (team === 'marketing') nav.push(...MARKETING_AREAS.map(({ href, label, icon }) => ({ href, label, icon })));
  /*
    Returns: operations checks, picks up and inspects; procurement handles suppliers;
    accounts sends the customer refund (the Refunds page, "Returned items" tab) and
    confirms supplier money;
    sellers raise returns for customers and follow their own.
  */
  if (['operations', 'procurement', 'accounts'].includes(team) || (team === 'sales' && canSell)) {
    nav.push({ href: '/team/returns', label: 'Returns', icon: Undo2 });
  }
  /*
    Payment requests: supplier payments (procurement), expenses (EVERY team —
    anyone can need fuel, a courier or a tool), and approving them (accounts).
    No list here: the API decides what each person may raise and see, and
    hiding the menu from a team that is allowed to claim is how GTM ended up
    paying its own fuel.
  */
  // Bank transfers on sales orders: accounts confirms them, GTM follows its own.
  if (team === 'accounts' || (team === 'sales' && canSell)) nav.push({ href: '/team/bank-transfers', label: 'Bank transfers', icon: Landmark });
  // Extra amounts on paid orders: GTM asks, accounts approves.
  if (team === 'accounts' || (team === 'sales' && canSell)) nav.push({ href: '/team/extra-charges', label: 'Extra charges', icon: Coins });
  // Sales made before the website: GTM enters its own, accounts corrects and deletes.
  if (team === 'accounts' || (team === 'sales' && canSell)) nav.push({ href: '/team/past-sales', label: 'Past sales', icon: History });
  nav.push({ href: '/team/payments', label: 'Payments', icon: Banknote });
  if (team === 'procurement' || team === 'accounts') nav.push({ href: '/team/suppliers', label: 'Suppliers', icon: Factory });
  // Heads of any team: customers' ratings of their salespeople (read only).
  if (isHead) nav.push({ href: '/team/sales-ratings', label: 'Service ratings', icon: Star });
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
  const { logout, user } = useAuth();
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
  const { items: visible, more } = splitMore(items, TEAM_MORE_HREFS);

  return (
    <PanelShell
      homeHref="/team"
      subtitle={`${teamLabel} Team`}
      sections={[{ items: visible, more }]}
      // The live auth user once loaded, so a name or photo change shows without a reload.
      user={{ name: user?.name || userName, photoUrl: user?.avatarUrl, profileHref: '/team/profile', role: roleLabel || (isHead ? 'Team head' : 'Team member') }}
      footer={canChangePassword && (
        <Link href={PASSWORD_PATH} className="pn-side-link inline-flex items-center gap-1.5 text-xs">
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Change password
        </Link>
      )}
      onLogout={signOut}
      // Every page: the menu is a slim icon strip that opens over the page on
      // hover, keyboard focus, or the menu button (phones, touch tablets).
      hoverRail
      // Tasks wants the room.
      tightPage={pathname === '/team/tasks' || pathname.startsWith('/team/tasks/')}
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
