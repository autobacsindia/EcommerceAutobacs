'use client';

import { ExternalLink } from 'lucide-react';
import CopyId from '@/components/ui/CopyId';
import { safeHttpUrl } from '@/lib/deliveryPartners';

/**
 * "Delhivery · Tracking 1234 [copy] [open]". The courier sites don't take the
 * number in their address, so the flow is: copy the number, open the page, paste.
 * The link icon shows only for an http(s) link, and opens in a new tab with
 * rel="noopener noreferrer". A parcel with no partner or no number still reads fine.
 */
export default function TrackingIdDisplay({
  partner, trackingNumber, url, className = '', empty = 'No tracking details',
}: {
  partner?: string | null;
  trackingNumber?: string | null;
  url?: string | null;
  className?: string;
  empty?: string;
}) {
  const name = (partner || '').trim();
  const id = (trackingNumber || '').trim();
  const href = safeHttpUrl(url);
  if (!name && !id) return <p className={className}>{empty}</p>;
  return (
    <p className={`flex flex-wrap items-center gap-x-1 ${className}`}>
      {name && <span>{name}</span>}
      {name && id && <span aria-hidden>·</span>}
      {id && <span>Tracking <span className="font-mono">{id}</span></span>}
      {id && <CopyId value={id} label="Tracking number" />}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer"
          aria-label={`Open ${name || 'the courier'}'s tracking page (new tab)`}
          title={`Open ${name || 'the courier'}'s tracking page`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:h-6 sm:w-6">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </p>
  );
}
