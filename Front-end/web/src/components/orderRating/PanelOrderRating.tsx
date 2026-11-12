'use client';

/**
 * Panel: the customer's rating of the sale/service on one order.
 *
 * - Admins and the salesperson's team head see the rating (read only — nobody
 *   can edit it).
 * - On a delivered OFFLINE order that has no rating yet, the salesperson (or
 *   their head, or an admin) can make a rating link and send it on WhatsApp.
 *   Website orders get theirs by email. The salesperson never sees the rating.
 *
 * Everyone else gets a 403 from the API and the card hides itself.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, Copy, Check, MessageCircle, AlertTriangle, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { orderRatingKeys } from '@/hooks/queries/keys';
import { formatDateIST } from '@/lib/datetime';

interface PanelRating {
  stars: number;
  comment: string;
  source: 'link' | 'account' | 'salesperson-link';
  createdAt: string;
  updatedAt: string;
  editCount: number;
  salesperson: { id: string; name: string } | null;
  sentBy: { id: string; name: string } | null;
  sameNetworkAsSender: boolean;
}

interface PanelState {
  rating: PanelRating | null;
  rated: boolean;
  canShareLink: boolean;
}

interface ShareLink {
  url: string;
  message: string;
  whatsappUrl: string;
  expiresAt: string;
}

const SOURCE_LABEL: Record<PanelRating['source'], string> = {
  link: 'from the email link',
  account: 'from their account',
  'salesperson-link': 'from the WhatsApp link',
};

function ShareLinkBox({ orderId }: { orderId: string }) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const make = async () => {
    setBusy(true);
    setError('');
    try {
      setLink(await apiClient.post<ShareLink>(`/order-ratings/panel/order/${orderId}/share-link`, {}));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not make the link.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — select the message and copy it by hand.');
    }
  };

  if (!link) {
    return (
      <div className="mt-2">
        <p className="text-sm text-gray-600">Not rated yet. Send the customer a link to rate our team.</p>
        <button
          type="button"
          onClick={make}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Get rating link
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="rounded-md border border-gray-200 bg-gray-50 p-2 text-sm text-gray-800 break-words">{link.message}</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={link.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          <MessageCircle className="h-4 w-4" aria-hidden /> Send on WhatsApp
        </a>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? 'Copied' : 'Copy message'}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Only the customer should open this link. A rating sent from the same internet connection as this link is flagged to the managers.
      </p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function PanelOrderRating({ orderId }: { orderId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const allowed = user?.role === 'admin' || user?.role === 'staff';
  const q = useQuery({
    queryKey: orderRatingKeys.panelOrder(orderId),
    queryFn: () => apiClient.get<PanelState>(`/order-ratings/panel/order/${orderId}`),
    enabled: allowed && !!orderId,
    retry: false,
  });

  if (!allowed || q.isError) return null;
  const data = q.data;
  // A salesperson with nothing to do here (a website order, or not delivered yet) sees nothing.
  if (data && !data.rating && !data.canShareLink && !data.rated && user?.role === 'staff' && !user.staff?.isHead) return null;
  const r = data?.rating;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5" aria-labelledby="panel-order-rating">
      <h2 id="panel-order-rating" className="text-sm font-semibold text-gray-900">Customer rating of our team</h2>
      {q.isPending ? (
        <p className="mt-2 text-sm text-gray-500">Loading…</p>
      ) : r ? (
        <div className="mt-2 space-y-1 text-sm text-gray-700">
          <div className="flex items-center gap-2">
            <span className="flex gap-0.5" aria-label={`${r.stars} out of 5 stars`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`h-4 w-4 ${r.stars >= n ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} aria-hidden />
              ))}
            </span>
            <span className="font-medium">{r.stars}/5</span>
            {r.salesperson && <span className="text-gray-500">· for {r.salesperson.name}</span>}
          </div>
          {r.comment && <p className="whitespace-pre-line text-gray-800">“{r.comment}”</p>}
          <p className="text-xs text-gray-500">
            {formatDateIST(r.createdAt)} · {SOURCE_LABEL[r.source]}
            {r.sentBy ? ` sent by ${r.sentBy.name}` : ''}
            {r.editCount > 0 ? ` · changed ${r.editCount}×` : ''}
          </p>
          {r.sameNetworkAsSender && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Rated from the same internet connection the link was made on. Check with the customer before counting it.
            </p>
          )}
        </div>
      ) : data?.canShareLink ? (
        <ShareLinkBox
          orderId={orderId}
          key={orderId}
        />
      ) : data?.rated ? (
        <p className="mt-2 text-sm text-gray-500">The customer has rated this order.</p>
      ) : (
        <p className="mt-2 text-sm text-gray-500">Not rated yet.</p>
      )}
      {/* Refresh after the customer rates, without a page reload. */}
      {data?.canShareLink && (
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: orderRatingKeys.panelOrder(orderId) })}
          className="mt-3 text-xs text-gray-500 underline"
        >
          Check again
        </button>
      )}
    </section>
  );
}
