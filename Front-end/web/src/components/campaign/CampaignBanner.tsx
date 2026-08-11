'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gift, X } from 'lucide-react';
import { useCampaign } from '@/hooks/queries/useCampaign';

/**
 * Site-wide reward ribbon for an eligible campaign customer.
 *
 * Load-bearing for this campaign's flow, not decoration: most invited customers arrive
 * by clicking a set-password link in an email, which lands them on the claim page rather
 * than back on the landing page. Without a persistent reminder they would be signed in
 * and eligible with nothing on screen saying so. The ribbon is what reconnects them to
 * the offer wherever they end up.
 *
 * Hidden on admin screens, on the cart (the savings meter already says it better, and
 * two competing reward callouts is noise), and once dismissed for the session.
 */
export default function CampaignBanner() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const { data: campaign } = useCampaign(0);

  const suppressed = pathname?.startsWith('/admin') || pathname === '/cart' || pathname === '/festive';
  if (suppressed || dismissed || !campaign?.eligible) return null;

  const topPercent = campaign.tiers?.length
    ? Math.max(...campaign.tiers.map((t) => t.percent))
    : null;

  return (
    <div className="relative bg-gradient-to-r from-gold/20 via-gold/10 to-transparent border-b border-gold/25">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 text-sm">
        <Gift size={15} className="shrink-0 text-gold" />
        <p className="flex-1 text-ink/90">
          <span className="font-semibold text-gold">Your festive reward is active.</span>{' '}
          <span className="hidden sm:inline">
            {topPercent ? `Up to ${topPercent}% off — ` : ''}add items and your saving grows.
          </span>
        </p>
        <Link href="/products" className="shrink-0 font-medium text-gold underline-offset-2 hover:underline">
          Shop now
        </Link>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss reward banner"
          className="shrink-0 rounded p-1 text-ink/40 transition hover:text-ink/80"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
