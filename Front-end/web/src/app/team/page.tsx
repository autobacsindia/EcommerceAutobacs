'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

/** What each team's panel will hold. Shown so the team knows what is coming. */
const COMING_SOON: Record<string, string[]> = {
  sales: [
    'Create an order for a WhatsApp / phone customer with the agreed price',
    'Send a payment link or QR that is tied to that order',
    'See live when the customer has paid, and follow the order to delivery',
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

export default function TeamDashboardPage() {
  const { user } = useAuth();
  const staff = user?.staff;
  const items = (staff && COMING_SOON[staff.team]) || [];

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

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Coming to your panel</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>

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
