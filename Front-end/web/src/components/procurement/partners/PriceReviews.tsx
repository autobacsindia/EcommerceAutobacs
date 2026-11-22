'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { applyPrice, errorMessage, keepPrice, listPriceReviews, paiseToRupees, partnerKeys, pct, rupees, type PriceReview } from './api';
import PriceBox, { priceSendable, priceState, type PriceBoxValue } from './PriceBox';
import { Empty, Loading, LoadError, MoreButton, Pills, btn, when } from './ui';

const TABS = [['pending', 'To decide'], ['applied', 'Price changed'], ['kept', 'Price kept']] as const;
type Tab = (typeof TABS)[number][0];

/** A supplier changed their price on a live product: pick the new selling price, or keep ours. */
export default function PriceReviews() {
  const [status, setStatus] = useState<Tab>('pending');
  const q = useInfiniteQuery({
    queryKey: partnerKeys.priceReviews(status),
    queryFn: ({ pageParam }) => listPriceReviews(status, pageParam),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">The website price never changes by itself when a supplier changes theirs. Decide here.</p>
      <Pills label="Which price changes" value={status} options={TABS} onChange={setStatus} />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} retry={() => q.refetch()} what="price changes" />}
      {q.isSuccess && rows.length === 0 && <Empty>{status === 'pending' ? 'No supplier price changes to decide.' : 'Nothing here yet.'}</Empty>}
      <ul className="space-y-3">{rows.map((r) => <li key={r.id}>{status === 'pending' ? <Decide r={r} /> : <Decided r={r} />}</li>)}</ul>
      <MoreButton hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />
    </div>
  );
}

function Header({ r }: { r: PriceReview }) {
  const up = r.newCostPaise > r.oldCostPaise;
  return (
    <div>
      <p className="font-semibold text-gray-900">{r.productName || r.listingTitle}</p>
      <p className="text-sm text-gray-600">
        {r.companyName}: {paiseToRupees(r.oldCostPaise)} → <strong className={up ? 'text-red-700' : 'text-green-700'}>{paiseToRupees(r.newCostPaise)}</strong> (without GST) · {when(r.createdAt)}
      </p>
    </div>
  );
}

function Decided({ r }: { r: PriceReview }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
      <Header r={r} />
      <p className="mt-1 text-gray-700">{r.status === 'applied' ? `Website price set to ${rupees(r.decidedPrice ?? 0)}` : `Kept at ${rupees(r.decidedPrice ?? 0)}`} by {r.decidedByName || '—'} · {when(r.decidedAt)}</p>
      {r.note && <p className="text-gray-500">{r.note}</p>}
    </div>
  );
}

function Decide({ r }: { r: PriceReview }) {
  const qc = useQueryClient();
  const rule = { targetBp: r.marginBp, floorBp: r.floorBp ?? 1000 };
  const [v, setV] = useState<PriceBoxValue>({ price: String(r.suggestedPrice), override: false, reason: '' });
  const [keepV, setKeepV] = useState<PriceBoxValue>({ price: String(r.currentPrice ?? ''), override: false, reason: '' });
  const apply = useMutation({
    mutationFn: () => applyPrice(r.id, { price: Number(v.price), ...(priceState(r.newCostPaise, r.gstPct, rule, v.price).belowFloor ? { override: v.override, overrideReason: v.reason } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: partnerKeys.all }),
  });
  const keep = useMutation({
    mutationFn: () => keepPrice(r.id, r.currentBelowFloor ? { override: keepV.override, overrideReason: keepV.reason } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: partnerKeys.all }),
  });
  const s = priceState(r.newCostPaise, r.gstPct, rule, v.price);
  const ks = priceState(r.newCostPaise, r.gstPct, rule, keepV.price);
  const err = apply.error || keep.error;
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <Header r={r} />
      {r.currentPrice != null && (
        <p className="text-sm text-gray-700">
          Website price now {rupees(r.currentPrice)}{r.currentMarginBp != null && <> — margin at the new supplier price <strong className={r.currentBelowFloor ? 'text-red-700' : 'text-green-700'}>{pct(r.currentMarginBp)}</strong></>}.
        </p>
      )}
      <PriceBox costPaise={r.newCostPaise} gstPct={r.gstPct} rule={rule} value={v} onChange={setV} label="New website price" currentPrice={r.currentPrice} />
      {r.currentBelowFloor && !r.currentBelowCost && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={keepV.override} onChange={(e) => setKeepV({ ...keepV, override: e.target.checked })} /> Keeping the price is below the floor — allow it
          {keepV.override && <input aria-label="Why keep it" value={keepV.reason} onChange={(e) => setKeepV({ ...keepV, reason: e.target.value })} placeholder="why?" className="ml-2 rounded border border-gray-300 px-2 py-1" />}
        </label>
      )}
      {err && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{errorMessage(err, 'Could not save.')}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.primary} disabled={!priceSendable(s, v) || apply.isPending || keep.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? 'Saving…' : `Set website price to ${s.valid ? rupees(s.price!) : '…'}`}
        </button>
        <button type="button" className={btn.secondary} disabled={r.currentBelowCost || !priceSendable(ks, keepV) || apply.isPending || keep.isPending} onClick={() => keep.mutate()}
          title={r.currentBelowCost ? 'The new supplier price is above our website price — it must change.' : undefined}>
          {keep.isPending ? 'Saving…' : 'Keep the current price'}
        </button>
      </div>
    </div>
  );
}
