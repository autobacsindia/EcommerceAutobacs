'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/utils';
import { reelKeys } from '@/hooks/queries/keys';
import { approveReel, errorText, type Reel } from './api';
import ReelActionDialog, { type ReelAction } from './ReelActionDialog';

const AVAILABILITY: Record<string, { label: string; cls: string }> = {
  in: { label: 'In stock', cls: 'bg-green-50 text-green-700' },
  low: { label: 'Low stock', cls: 'bg-amber-50 text-amber-700' },
  out: { label: 'Out of stock', cls: 'bg-red-50 text-red-700' },
  backorder: { label: 'On backorder', cls: 'bg-blue-50 text-blue-700' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ReelCard({ reel }: { reel: Reel }) {
  const [action, setAction] = useState<ReelAction | null>(null);
  const qc = useQueryClient();
  // Not optimistic: the card stays in "Waiting" until the server confirms, then every tab refetches.
  const approve = useMutation({
    mutationFn: () => approveReel(reel.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: reelKeys.admin() }),
  });
  // productLive is the backend's word; a null product means the same thing.
  const p = reel.productLive === false ? null : reel.product;
  const src = reel.mp4Url || undefined;

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" data-testid="reel-card">
      {/* 9:16 frame reserved up front so the grid doesn't jump while posters load. */}
      <div className="relative aspect-[3/4] w-full bg-black min-[420px]:aspect-[9/16]">
        {src ? (
          <video
            className="h-full w-full object-contain"
            src={src}
            poster={reel.posterUrl || undefined}
            controls
            playsInline
            preload="none"
            aria-label={`Reel by ${reel.creator?.name ?? 'unknown creator'}`}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-300">Video is still processing.</div>
        )}
        {reel.durationSec ? (
          <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {Math.round(reel.durationSec)}s
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold text-gray-800">{reel.creator?.name || 'Unknown creator'}</span>
            {reel.source === 'team' && <span className="shrink-0 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">Team</span>}
          </span>
          <time dateTime={reel.createdAt}>{formatDate(reel.createdAt)}</time>
        </div>

        {reel.caption ? <p className="line-clamp-3 whitespace-pre-line text-sm text-gray-800">{reel.caption}</p> : <p className="text-sm italic text-gray-400">No caption</p>}

        {p ? (
          <a href={`/products/${encodeURIComponent(p.slug)}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-2 hover:bg-gray-100">
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail from any allowed host
              <img src={p.image} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" />
            ) : <div className="h-12 w-12 shrink-0 rounded bg-gray-200" />}
            <div className="min-w-0">
              <p className="line-clamp-2 text-xs font-medium text-gray-900">{p.title}</p>
              <p className="mt-0.5 text-xs">
                <span className="font-semibold text-gray-900">{formatCurrency(p.price)}</span>
                {p.mrp && p.mrp > p.price ? <span className="ml-1 text-gray-400 line-through">{formatCurrency(p.mrp)}</span> : null}
                {p.hasVariants ? <span className="ml-1 text-gray-500">onwards</span> : null}
              </p>
              {p.festivalPrice ? <p className="text-[11px] font-medium text-orange-700">Festival offer {formatCurrency(p.festivalPrice)}</p> : null}
              {AVAILABILITY[p.availability] ? (
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${AVAILABILITY[p.availability].cls}`}>{AVAILABILITY[p.availability].label}</span>
              ) : null}
            </div>
          </a>
        ) : (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">The tagged product is no longer on sale, so this reel is hidden from shoppers.</p>
        )}

        {reel.status === 'rejected' && reel.rejectReason ? (
          <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800"><span className="font-semibold">Reason: </span>{reel.rejectReason}</p>
        ) : null}
        <ReelStats reel={reel} />

        {approve.isError ? (
          <p role="alert" className="text-xs text-red-700">{errorText(approve.error, 'Could not approve this reel. Please try again.')}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2">
          {reel.status === 'pending' && (
            <>
              <button type="button" onClick={() => approve.mutate()} disabled={approve.isPending}
                className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60">
                {approve.isPending ? 'Approving…' : 'Approve'}
              </button>
              <button type="button" onClick={() => setAction('reject')} disabled={approve.isPending}
                className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Reject</button>
            </>
          )}
          {reel.status === 'rejected' && (
            <button type="button" onClick={() => approve.mutate()} disabled={approve.isPending}
              className="flex-1 rounded-lg border border-green-600 bg-white px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-60">
              {approve.isPending ? 'Approving…' : 'Approve after all'}
            </button>
          )}
          {reel.status === 'approved' && (
            <button type="button" onClick={() => setAction('remove')}
              className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Remove</button>
          )}
        </div>
      </div>

      {action && <ReelActionDialog reel={reel} action={action} onClose={() => setAction(null)} />}
    </li>
  );
}

function ReelStats({ reel }: { reel: Reel }) {
  const parts: string[] = [];
  if (reel.status === 'approved' || reel.status === 'removed') {
    if (typeof reel.viewCount === 'number') parts.push(`${reel.viewCount} views`);
    parts.push(`${reel.likeCount} likes`);
  }
  const reports = reel.reportCount ?? 0;
  if (!parts.length && !reports) return null;
  return (
    <p className="text-xs text-gray-500">
      {parts.join(' · ')}
      {reports > 0 && (
        <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">
          {reports} {reports === 1 ? 'report' : 'reports'}
        </span>
      )}
    </p>
  );
}
