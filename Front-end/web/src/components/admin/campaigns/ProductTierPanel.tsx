'use client';

/*
  Lives outside the route file because a Next.js `page.tsx` may only export a
  default plus the framework's own fields — a named export there fails the build.
*/

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, AlertTriangle, Tag, Trash2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { campaignKeys } from '@/hooks/queries/keys';

const inr = (n: number | null | undefined) => `₹${(n ?? 0).toLocaleString('en-IN')}`;
const field = 'w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-gold focus:outline-none';
const card = 'rounded-lg border border-zinc-800 bg-zinc-900/40 p-6';

/**
 * Per-product discount tiers — author from a search query, REVIEW, then commit.
 *
 * The review step is the entire point of this screen, not a nicety. Tiers are written
 * as search queries because that is how a human describes "all the Proman stuff", but a
 * query is fuzzy, relevance-ranked and moves with the index, so it cannot be the thing
 * that decides a price. So: the query proposes, an operator disposes, and what gets
 * written down is a fixed list of products.
 *
 * The case that shaped this: the original spec said `cbmcup`, a typo for `comeup`.
 * `comeup` matches 6 products. `cbmcup` matches 928 — the whole catalogue. Committed
 * blind it would have put every product in the 3% tier and dragged the 5% and 8% tiers
 * down with it, silently. Hence the preview, the deselection, and the refusal.
 *
 * Nothing here prices a cart. It records membership; the pricing service reads it.
 */

interface TierDef {
  code: string;
  label: string | null;
  percent: number;
  isDefault?: boolean;
  matchQueries?: string[];
}

interface PreviewProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  price: number;
  originalPrice: number | null;
  onSale: boolean;
  currentTier: string | null;
  resultingTier: string | null;
}

interface PreviewResult {
  query: string;
  tierCode: string;
  matched: number;
  catalogueTotal: number;
  ratio: number;
  truncated: boolean;
  requiresConfirmation: boolean;
  warning: string | null;
  products: PreviewProduct[];
  onSaleCount: number;
  movedByOverlap: number;
}

interface AssignmentRow {
  _id: string;
  tierCode: string;
  matchedCodes: string[];
  matchedQueries: string[];
  source: 'query' | 'manual';
  product: { _id: string; name: string; slug: string; price: number; originalPrice: number | null; brand: string | null } | null;
}

interface TiersPage {
  rows: AssignmentRow[];
  nextCursor: string | null;
  counts: Record<string, number> | null;
  tiers: TierDef[];
}

export default function ProductTierPanel({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();

  const [tierCode, setTierCode] = useState('');
  const [queryText, setQueryText] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // Deselection is why the preview exists, so it is tracked explicitly rather than
  // inferred — an operator must be able to drop the two products a query dragged in.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [filterTier, setFilterTier] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cursor = cursors[cursors.length - 1];

  const { data, isLoading } = useQuery<TiersPage>({
    queryKey: campaignKeys.productTiers(campaignId, { tierCode: filterTier, cursor }),
    queryFn: () => apiClient.get(API_ENDPOINTS.CAMPAIGN_PRODUCT_TIERS(campaignId), {
      params: { ...(filterTier ? { tierCode: filterTier } : {}), ...(cursor ? { cursor } : {}), limit: 50 },
    }),
  });

  const tiers = data?.tiers ?? [];
  const assignable = tiers.filter((t) => !t.isDefault);
  const counts = data?.counts ?? null;

  const resetPaging = () => setCursors([null]);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: campaignKeys.productTiersFor(campaignId) });
    queryClient.invalidateQueries({ queryKey: campaignKeys.productTierDrift(campaignId) });
  };

  const previewMutation = useMutation({
    mutationFn: (): Promise<PreviewResult> =>
      apiClient.get(API_ENDPOINTS.CAMPAIGN_PRODUCT_TIER_PREVIEW(campaignId), {
        params: { tierCode, query: queryText.trim() },
      }),
    onSuccess: (result) => { setPreview(result); setExcluded(new Set()); setError(null); },
    onError: (err: Error) => { setPreview(null); setError(err.message); },
  });

  const commitMutation = useMutation({
    mutationFn: (confirm: boolean) =>
      apiClient.post(API_ENDPOINTS.CAMPAIGN_PRODUCT_TIERS(campaignId), {
        tierCode,
        query: preview?.query,
        // The REVIEWED selection is what gets written — never the raw match.
        productIds: preview?.products.filter((p) => !excluded.has(p.id)).map((p) => p.id),
        confirm,
      }),
    onSuccess: () => { setPreview(null); setExcluded(new Set()); setError(null); resetPaging(); invalidate(); },
    onError: (err: Error) => setError(err.message),
  });

  const unassignMutation = useMutation({
    mutationFn: (code: string) =>
      apiClient.delete(API_ENDPOINTS.CAMPAIGN_PRODUCT_TIER_ITEM(campaignId, code)),
    onSuccess: () => { resetPaging(); invalidate(); },
    onError: (err: Error) => setError(err.message),
  });

  const { data: drift, refetch: refetchDrift, isFetching: driftLoading } = useQuery<{
    unassigned: number;
    byTier: { tierCode: string; label: string; query: string; missing: { id: string; name: string }[] }[];
  }>({
    queryKey: campaignKeys.productTierDrift(campaignId),
    queryFn: () => apiClient.get(API_ENDPOINTS.CAMPAIGN_PRODUCT_TIER_DRIFT(campaignId)),
    enabled: false,
  });

  const selectedCount = preview ? preview.products.length - excluded.size : 0;
  const toggle = (id: string) => setExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!tiers.length) {
    return (
      <section className={card}>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <Tag size={18} /> Product tiers
        </h2>
        <p className="text-sm text-zinc-400">
          This campaign has no product-tier ladder yet. Add one in the campaign settings
          (a rate per tier, plus exactly one “everything else” default) and it will appear here.
        </p>
      </section>
    );
  }

  return (
    <section className={card}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Tag size={18} /> Product tiers
        </h2>
        <button
          type="button"
          onClick={() => refetchDrift()}
          disabled={driftLoading}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-gold hover:text-white disabled:opacity-50"
        >
          <RefreshCw size={13} className={driftLoading ? 'animate-spin' : ''} />
          Check for unassigned products
        </button>
      </div>

      {/* The ladder, with what is actually in each tier right now. */}
      <div className="mb-6 flex flex-wrap gap-2">
        {tiers.map((t) => (
          <button
            key={t.code}
            type="button"
            onClick={() => { setFilterTier(filterTier === t.code ? '' : t.code); resetPaging(); }}
            disabled={t.isDefault}
            className={`rounded px-3 py-1.5 text-xs ring-1 ${
              filterTier === t.code ? 'bg-gold/20 text-gold ring-gold/40' : 'bg-zinc-800/60 text-zinc-300 ring-zinc-700'
            } ${t.isDefault ? 'cursor-default opacity-70' : ''}`}
          >
            <span className="font-medium">{t.label || t.code}</span>
            <span className="ml-1.5 text-zinc-400">{t.percent}%</span>
            {t.isDefault
              // The default has no membership by construction — it is what a product
              // gets when nothing else matched, so there is nothing to list or filter.
              ? <span className="ml-1.5 text-zinc-500">· everything else</span>
              : <span className="ml-1.5 text-zinc-500">· {counts?.[t.code] ?? 0}</span>}
          </button>
        ))}
      </div>

      {/* ── Author ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 grid gap-3 sm:grid-cols-[200px_1fr_auto]">
        <select
          aria-label="Tier"
          className={field}
          value={tierCode}
          onChange={(e) => { setTierCode(e.target.value); setPreview(null); }}
        >
          <option value="">Choose a tier…</option>
          {assignable.map((t) => (
            <option key={t.code} value={t.code}>{t.label || t.code} — {t.percent}%</option>
          ))}
        </select>
        <input
          className={field}
          placeholder="Search query, e.g. proman"
          value={queryText}
          onChange={(e) => { setQueryText(e.target.value); setPreview(null); }}
        />
        <button
          type="button"
          onClick={() => previewMutation.mutate()}
          disabled={!tierCode || !queryText.trim() || previewMutation.isPending}
          className="flex items-center gap-1.5 rounded bg-gold px-4 py-2 text-sm font-medium text-black hover:bg-gold/90 disabled:opacity-40"
        >
          <Search size={14} /> {previewMutation.isPending ? 'Searching…' : 'Preview'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* ── Review ─────────────────────────────────────────────────────────── */}
      {preview && (
        <div className="mb-6 rounded border border-zinc-700 bg-zinc-900/60 p-4">
          <p className="mb-3 text-sm text-zinc-300">
            <strong className="text-white">{preview.matched}</strong> products match{' '}
            <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-gold">{preview.query}</code>
            {' '}— {((preview.ratio) * 100).toFixed(1)}% of {preview.catalogueTotal} active products.
            {preview.onSaleCount > 0 && (
              <> <strong className="text-amber-300">{preview.onSaleCount}</strong> already on offer, so those get 2% instead.</>
            )}
            {preview.movedByOverlap > 0 && (
              <> <strong className="text-sky-300">{preview.movedByOverlap}</strong> already sit in a lower tier and will stay there.</>
            )}
          </p>

          {preview.requiresConfirmation && (
            <p className="mb-3 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{preview.warning}</span>
            </p>
          )}

          <div className="max-h-80 overflow-y-auto rounded border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-zinc-900 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Include</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">Lands in</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {preview.products.map((p) => {
                  const dropped = excluded.has(p.id);
                  return (
                    <tr key={p.id} className={dropped ? 'opacity-40' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={!dropped}
                          onChange={() => toggle(p.id)}
                          aria-label={`Include ${p.name}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-zinc-200">
                        {p.name}
                        {p.brand && <span className="ml-2 text-xs text-zinc-500">{p.brand}</span>}
                      </td>
                      <td className="px-3 py-2 text-zinc-300">
                        {inr(p.price)}
                        {p.onSale && <span className="ml-2 text-xs text-amber-300">on offer → 2%</span>}
                      </td>
                      <td className="px-3 py-2 text-zinc-300">
                        {p.resultingTier === tierCode
                          ? <span className="text-emerald-300">{tierLabel(tiers, p.resultingTier)}</span>
                          // Lowest-wins kept it where it was. Said plainly here so the
                          // outcome is a reviewed decision, not a later surprise.
                          : <span className="text-sky-300">stays {tierLabel(tiers, p.resultingTier)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => commitMutation.mutate(preview.requiresConfirmation)}
              disabled={selectedCount === 0 || commitMutation.isPending}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {commitMutation.isPending ? 'Assigning…' : `Assign ${selectedCount} product${selectedCount === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={() => { setPreview(null); setExcluded(new Set()); }}
              className="text-sm text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Drift ──────────────────────────────────────────────────────────── */}
      {drift && (
        <div className="mb-6 rounded border border-zinc-700 bg-zinc-900/60 p-4 text-sm">
          {drift.unassigned === 0 ? (
            <p className="text-emerald-300">Every product matching a saved tier query is assigned.</p>
          ) : (
            <>
              {/* The cost of materializing membership: products added after an
                  assignment ran would sit in the default tier forever, unnoticed. */}
              <p className="mb-2 text-amber-200">
                {drift.unassigned} product{drift.unassigned === 1 ? '' : 's'} match a tier’s saved
                query but have no assignment — they are currently getting the default rate.
              </p>
              <ul className="space-y-1 text-zinc-300">
                {drift.byTier.map((d) => (
                  <li key={`${d.tierCode}-${d.query}`}>
                    <span className="text-zinc-500">{d.label} · “{d.query}”:</span>{' '}
                    {d.missing.map((m) => m.name).join(', ')}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* ── Current assignments ────────────────────────────────────────────── */}
      {isLoading ? (
        <p className="text-sm text-zinc-400">Loading assignments…</p>
      ) : !data?.rows.length ? (
        <p className="text-sm text-zinc-400">
          Nothing assigned yet{filterTier ? ' in this tier' : ''}. Everything falls to the default rate.
        </p>
      ) : (
        <>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Tier</th>
                <th className="px-3 py-2 font-medium">Also matched</th>
                <th className="px-3 py-2 font-medium">From</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {data.rows.map((row) => (
                <tr key={row._id}>
                  <td className="px-3 py-2 text-zinc-200">{row.product?.name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200">
                      {tierLabel(tiers, row.tierCode)} · {tierPercent(tiers, row.tierCode)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {/* Why this product is where it is — the answer to "why is this
                        Profender kit at 3% when Thanos is 8%?" is one row, not a
                        re-derivation from queries that may since have been edited. */}
                    {row.matchedCodes.filter((c) => c !== row.tierCode).map((c) => tierLabel(tiers, c)).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{row.matchedQueries.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={cursors.length === 1}
              onClick={() => setCursors((c) => c.slice(0, -1))}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!data.nextCursor}
              onClick={() => setCursors((c) => [...c, data.nextCursor])}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
            >
              Next
            </button>
            {filterTier && (
              <button
                type="button"
                onClick={() => {
                  // Destructive and not obviously reversible, so it asks. Products that
                  // also matched another tier are demoted rather than dropped.
                  if (window.confirm(`Remove every product from ${tierLabel(tiers, filterTier)}? Products that also match another tier will move to that one.`)) {
                    unassignMutation.mutate(filterTier);
                  }
                }}
                className="ml-auto flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300"
              >
                <Trash2 size={13} /> Clear this tier
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const tierLabel = (tiers: TierDef[], code: string | null) =>
  tiers.find((t) => t.code === code)?.label || code || 'default';

const tierPercent = (tiers: TierDef[], code: string | null) =>
  tiers.find((t) => t.code === code)?.percent ?? 0;
