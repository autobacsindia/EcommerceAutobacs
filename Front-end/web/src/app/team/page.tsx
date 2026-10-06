'use client';

import Link from 'next/link';
import { Users, PlusCircle, ReceiptText, BadgeCheck, PackageSearch, PhoneCall, Wallet, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/** Still to come, per team. Shown so the team knows what is planned. */
const COMING_SOON: Record<string, string[]> = {
  sales: [],
  procurement: ['Reminders when an order has waited too long for a stock check or supplier proof'],
  accounts: ['Daily payment and refund reports'],
  operations: ['Reminders for parcels that have been in transit too long'],
  marketing: [
    'Orders and leads by source: Google Ads, Meta, website',
    'Coupon and campaign performance',
  ],
};

type Shortcut = { href: string; title: string; text: string; icon: LucideIcon };

const PAID: Shortcut = {
  href: '/team/orders', title: 'Paid orders',
  text: 'Every paid order — website and sales — with who sold it, the payment and where it is up to.', icon: BadgeCheck,
};

/** What each team can do — the same split the API enforces. */
function shortcutsFor(team: string | undefined, isHead: boolean): Shortcut[] {
  switch (team) {
    case 'sales': {
      const list: Shortcut[] = [
        { href: '/team/sales/new', title: 'New order', text: 'For a customer on the phone or WhatsApp: pick products, give an offer price, send a payment link and QR.', icon: PlusCircle },
        { href: '/team/sales', title: isHead ? 'Team orders' : 'My orders', text: 'Payment, stock, the supplier\'s photo and tracking — and a button to send them to the customer.', icon: ReceiptText },
        { href: '/team/decisions', title: 'Customer decisions', text: 'Out-of-stock items: ask the customer to wait or take a refund.', icon: PhoneCall },
      ];
      if (isHead) list.push(PAID);
      return list;
    }
    case 'procurement':
      return [{ href: '/team/procurement', title: 'Stock & shipping', text: 'Check stock for each paid order, record the supplier, upload the supplier\'s photo when dispatched.', icon: PackageSearch }, PAID];
    case 'accounts':
      return [{ href: '/team/refunds', title: 'Refund approvals', text: 'Approve refunds for out-of-stock items. An admin then pays them.', icon: Wallet }, PAID];
    case 'operations':
      return [{ href: '/team/deliveries', title: 'Deliveries', text: 'Parcels on their way — follow up and mark them delivered.', icon: Truck }, PAID];
    default:
      return [];
  }
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
