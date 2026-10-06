'use client';

import Link from 'next/link';
import { Users, PlusCircle, ReceiptText, BadgeCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/** What each team's panel will hold. Shown so the team knows what is coming. */
const COMING_SOON: Record<string, string[]> = {
  sales: [
    'Follow each paid order through stock check, shipping and delivery',
  ],
  procurement: [
    'See every paid order waiting for a stock check',
    'Mark each one In stock, or Not available (sends it for refund)',
    'Add the courier, tracking number and shipping photo',
  ],
  accounts: [
    'Approve each payment before the order can ship',
    'Work the refund queue for orders that cannot be fulfilled',
    'Daily payment and refund reports',
  ],
  marketing: [
    'Orders and leads by source: Google Ads, Meta, website',
    'Coupon and campaign performance',
  ],
};

type Shortcut = { href: string; title: string; text: string; icon: LucideIcon };

/** What each team can already do — the same split the API enforces. */
function shortcutsFor(team: string | undefined, isHead: boolean): Shortcut[] {
  if (team === 'sales') {
    const list: Shortcut[] = [
      { href: '/team/sales/new', title: 'New order', text: 'For a customer on the phone or WhatsApp: pick products, give an offer price, send a payment link and QR.', icon: PlusCircle },
      { href: '/team/sales', title: isHead ? 'Team orders' : 'My orders', text: 'See who has paid, resend a link or cancel an unpaid order.', icon: ReceiptText },
    ];
    if (isHead) list.push({ href: '/team/orders', title: 'Paid orders', text: 'Every sales order the customer has paid for.', icon: BadgeCheck });
    return list;
  }
  if (team === 'accounts' || team === 'procurement') {
    return [{ href: '/team/orders', title: 'Paid orders', text: 'Orders the sales team took by phone or WhatsApp, once paid. You are also emailed for each one.', icon: BadgeCheck }];
  }
  return [];
}

export default function TeamDashboardPage() {
  const { user } = useAuth();
  const staff = user?.staff;
  const items = (staff && COMING_SOON[staff.team]) || [];
  const shortcuts = shortcutsFor(staff?.team, !!staff?.isHead);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome{user?.name ? `, ${user.name}` : ''}
        </h1>
        <p className="text-sm text-gray-500">
          {staff ? `${staff.teamLabel} team · ${staff.isHead ? 'Team head' : 'Team member'}` : 'Team panel'}
        </p>
      </div>

      {shortcuts.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {shortcuts.map(({ href, title, text, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-5 hover:border-blue-400">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
              <div>
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-xs text-gray-500">{text}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {items.length > 0 && (
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Coming to your panel</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      )}

      <Link
        href="/team/members"
        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-5 hover:border-blue-400"
      >
        <Users className="h-5 w-5 text-blue-600" />
        <div>
          <p className="text-sm font-semibold text-gray-900">My team</p>
          <p className="text-xs text-gray-500">
            {staff?.isHead ? 'Add people to your team or remove their access.' : 'See who is on your team.'}
          </p>
        </div>
      </Link>
    </div>
  );
}
