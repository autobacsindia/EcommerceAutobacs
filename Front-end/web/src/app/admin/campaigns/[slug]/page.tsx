'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Calculator, Upload, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { campaignKeys } from '@/hooks/queries/keys';
import { istStartOfDayISO, istEndOfDayISO, toISTDateInput } from '@/lib/istDate';
import MemberRosterPanel from '@/components/admin/campaigns/MemberRosterPanel';
import ProductTierPanel from '@/components/admin/campaigns/ProductTierPanel';

/**
 * Admin — campaign editor.
 *
 * Every number that costs money is editable here and takes effect on the next cart.
 * Two guards are deliberately server-side rather than in this form, so they hold for
 * the seed script and any future caller too: a tier ladder whose discount FALLS as the
 * cart grows is rejected outright, and an "everyone" campaign cannot go live without a
 * redemption cap. This page just surfaces those errors plainly.
 *
 * The calculator exists because a mispriced ladder is cheapest to catch here — ten
 * seconds of checking beats discovering it in a customer's basket.
 *
 * ── Two MODES, and the page renders the one it is in ────────────────────────────
 *
 * A campaign is priced EITHER by cart value (`tiers`: "spend over ₹1 lakh, get 10%")
 * OR per product (`productTiers`: "Profender 8%, Proman 3%, everything else 4%"). The
 * server refuses both at once, and the two are configured, explained and checked in
 * completely different ways.
 *
 * This page used to render the cart-value UI unconditionally, which made it lie about a
 * product-tier campaign: it described best-for-customer resolution when the real rule is
 * lowest-wins per product, offered an "add a tier" button whose save the server would
 * reject, and ran a calculator that resolved an empty ladder and reported ₹0 for every
 * row — reading, to an operator, as "this offer pays nothing".
 *
 * Audience is a SEPARATE axis: an allowlist campaign has a roster and an invited count,
 * an 'everyone' campaign has neither, and showing 191 inert CampaignMember rows against
 * a public offer invites exactly the wrong conclusion about who can redeem.
 */

type CampaignStatus = 'draft' | 'testing' | 'live' | 'off';

/** A rung of the PER-PRODUCT ladder. `code` is an identifier, not a label. */
interface ProductTier {
  code: string;
  label?: string | null;
  percent: number;
  isDefault?: boolean;
  matchQueries?: string[];
}

interface Tier {
  id: string;
  label?: string | null;
  minCartValue: number;
  maxCartValue?: number | null;
  percent: number;
  maxDiscount?: number | null;
}

interface Campaign {
  _id: string;
  slug: string;
  name: string;
  description?: string;
  status: CampaignStatus;
  audience: 'list' | 'everyone';
  requireVerifiedEmail: boolean;
  allowKarmaStacking: boolean;
  testerEmails: string[];
  startsAt: string | null;
  endsAt: string | null;
  tiers: Tier[];
  productTiers?: ProductTier[];
  resolution: 'best' | 'window';
  maxDiscountPerOrder: number | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  discountGivenRupees: number;
  couponCode: string | null;
  landingPath: string | null;
}

interface Report {
  members: { invited: number; claimed: number; redeemed: number; total: number };
  redeemedCount: number;
  maxRedemptions: number | null;
  discountGivenRupees: number;
  remainingExposureRupees: number | null;
}

const inr = (n: number | null | undefined) => `₹${(n ?? 0).toLocaleString('en-IN')}`;
// IST-aware, so a 15 Aug start does not read back as 14 Aug. See lib/istDate.ts.
const toDateInput = (d: string | null) => toISTDateInput(d);

const label = 'block text-xs font-medium uppercase tracking-wide text-zinc-500 mb-1.5';
const field = 'w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-gold focus:outline-none';
const card = 'rounded-lg border border-zinc-800 bg-zinc-900/40 p-6';

export default function AdminCampaignEditor() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Partial<Campaign> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: campaignKeys.detail(slug),
    queryFn: () => apiClient.get<{ success: boolean; campaign: Campaign }>(API_ENDPOINTS.CAMPAIGN_ADMIN(slug)),
  });
  const { data: reportData } = useQuery({
    queryKey: campaignKeys.report(slug),
    queryFn: () => apiClient.get<{ success: boolean; report: Report }>(API_ENDPOINTS.CAMPAIGN_REPORT(slug)),
  });

  const campaign = data?.campaign;
  const report = reportData?.report;
  const value = <K extends keyof Campaign>(k: K): Campaign[K] | undefined =>
    (draft?.[k] ?? campaign?.[k]) as Campaign[K] | undefined;
  const set = (patch: Partial<Campaign>) => setDraft((d) => ({ ...(d ?? {}), ...patch }));

  const save = useMutation({
    mutationFn: (payload: Partial<Campaign>) =>
      apiClient.put(API_ENDPOINTS.CAMPAIGN_DETAIL(campaign!._id), payload),
    onSuccess: () => {
      setDraft(null);
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: campaignKeys.all });
    },
    onError: (e: Error) => setSaveError(e.message),
  });

  if (isLoading || !campaign) return <div className="p-8 text-zinc-400">Loading…</div>;

  const tiers = (value('tiers') ?? []) as Tier[];
  const setTier = (i: number, patch: Partial<Tier>) =>
    set({ tiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  const productTiers = (value('productTiers') ?? []) as ProductTier[];
  const setProductTier = (i: number, patch: Partial<ProductTier>) =>
    set({ productTiers: productTiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  /*
    Which ladder is this campaign priced by? Derived from the saved config rather than
    stored as a flag, so it can never disagree with what the pricing engine will do —
    pricingService takes the same branch on the same condition.
  */
  const isProductMode = productTiers.length > 0;
  const isAllowlist = value('audience') === 'list';

  return (
    <div className="p-8 max-w-5xl">
      <Link href="/admin/campaigns" className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft size={14} /> All campaigns
      </Link>

      <div className="mb-8 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
        <span className="text-sm text-zinc-500">
          {campaign.status} · {campaign.audience === 'list' ? 'invited only' : 'everyone'}
        </span>
      </div>

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {report && (
        <div className={`${card} mb-6`}>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">Results</h2>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              /*
                Invited / Signed in count CampaignMember rows, which only mean anything
                for an allowlist campaign. An 'everyone' audience never reads that
                collection — evaluate() skips it entirely — so reporting "Invited 191"
                against a public offer describes a mailing list, not who may redeem, and
                reads as a restriction that no longer exists.
              */
              ...(isAllowlist
                ? [
                    ['Invited', report.members.total] as const,
                    ['Signed in', report.members.claimed + report.members.redeemed] as const,
                  ]
                : []),
              ['Redeemed', report.redeemedCount] as const,
              ['Given away', inr(report.discountGivenRupees)] as const,
            ].map(([k, v]) => (
              <div key={k as string}>
                <p className="text-xs uppercase tracking-wide text-zinc-500">{k}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{v}</p>
              </div>
            ))}
          </div>
          {report.remainingExposureRupees != null && (
            <p className="mt-4 border-t border-zinc-800 pt-4 text-sm text-zinc-400">
              Still on the table if every remaining slot redeems the maximum:{' '}
              <span className="text-white">{inr(report.remainingExposureRupees)}</span>
            </p>
          )}
        </div>
      )}

      {/* ── The CART-VALUE ladder — only for a campaign priced that way ─────── */}
      {!isProductMode && (
      <div className={`${card} mb-6`}>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-400">Discount tiers</h2>
        <p className="mb-4 text-xs text-zinc-500">
          {value('resolution') === 'best'
            ? 'Best-for-customer: whichever tier gives the most is applied, so a customer’s saving never falls as their cart grows.'
            : 'Window: the first tier whose range contains the cart value wins. This can reduce a discount as a cart grows.'}
        </p>

        <div className="space-y-3">
          {tiers.map((t, i) => (
            <div key={i} className="grid grid-cols-2 gap-3 rounded border border-zinc-800 p-3 sm:grid-cols-5">
              <div>
                <label className={label}>Label</label>
                <input className={field} value={t.label ?? ''} onChange={(e) => setTier(i, { label: e.target.value })} />
              </div>
              <div>
                <label className={label}>Cart from ₹</label>
                <input type="number" className={field} value={t.minCartValue ?? 0}
                  onChange={(e) => setTier(i, { minCartValue: Number(e.target.value) })} />
              </div>
              <div>
                <label className={label}>Percent off</label>
                <input type="number" className={field} value={t.percent ?? 0}
                  onChange={(e) => setTier(i, { percent: Number(e.target.value) })} />
              </div>
              <div>
                <label className={label}>Cap ₹ (blank = none)</label>
                <input type="number" className={field} value={t.maxDiscount ?? ''}
                  onChange={(e) => setTier(i, { maxDiscount: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => set({ tiers: tiers.filter((_, j) => j !== i) })}
                  className="rounded p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                  title="Remove tier"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => set({ tiers: [...tiers, { id: `tier${tiers.length + 1}`, minCartValue: 0, percent: 10, maxDiscount: null }] })}
          className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
        >
          <Plus size={14} /> Add a tier
        </button>

      </div>
      )}

      {/* ── The PER-PRODUCT ladder ──────────────────────────────────────────── */}
      {isProductMode && (
        <ProductLadderCard
          tiers={productTiers}
          setTier={setProductTier}
          setAll={(next) => set({ productTiers: next })}
        />
      )}

      {/*
        Limits apply to BOTH ladders, so they live outside either one. They used to sit
        inside the cart-value card, which meant hiding that card for a product-tier
        campaign would have taken the redemption cap with it — and an 'everyone'
        campaign cannot go live without one.
      */}
      <div className={`${card} mb-6`}>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">Limits</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Most any single order can save ₹</label>
            <input type="number" className={field} value={value('maxDiscountPerOrder') ?? ''}
              onChange={(e) => set({ maxDiscountPerOrder: e.target.value === '' ? null : Number(e.target.value) })} />
            <p className="mt-1 text-xs text-zinc-600">
              {isProductMode
                ? 'Ceiling across the whole order, shared out across the discounted lines.'
                : 'Bounds an uncapped tier on a very large cart.'}
            </p>
          </div>
          <div>
            <label className={label}>Maximum redemptions</label>
            <input type="number" className={field} value={value('maxRedemptions') ?? ''}
              onChange={(e) => set({ maxRedemptions: e.target.value === '' ? null : Number(e.target.value) })} />
            <p className="mt-1 text-xs text-zinc-600">
              The campaign closes itself when this is reached.
              {!isAllowlist && ' Required before an open campaign can go live.'}
            </p>
          </div>
        </div>
      </div>

      {/* The right calculator for the ladder in use. The cart-value one resolves
          `tiers`, so against a product-tier campaign it reports ₹0 for every row. */}
      {isProductMode
        ? <ProductCalculatorPanel campaignId={campaign._id} />
        : <SimulatorPanel campaignId={campaign._id} />}

      {/* ── Schedule and audience ───────────────────────────────────────────── */}
      <div className={`${card} mb-6`}>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">Schedule &amp; audience</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Starts</label>
            <input type="date" className={field} value={toDateInput(value('startsAt') ?? null)}
              onChange={(e) => set({ startsAt: e.target.value ? istStartOfDayISO(e.target.value) : null })} />
            <p className="mt-1 text-xs text-zinc-600">Opens at 00:00 IST on this date.</p>
          </div>
          <div>
            <label className={label}>Ends</label>
            <input type="date" className={field} value={toDateInput(value('endsAt') ?? null)}
              onChange={(e) => set({ endsAt: e.target.value ? istEndOfDayISO(e.target.value) : null })} />
            <p className="mt-1 text-xs text-zinc-600">Closes at 23:59 IST on this date. Required before the campaign can run.</p>
          </div>
          <div>
            <label className={label}>Who qualifies</label>
            <select className={field} value={value('audience')}
              onChange={(e) => set({ audience: e.target.value as Campaign['audience'] })}>
              <option value="list">Invited customers only</option>
              <option value="everyone">Everyone</option>
            </select>
          </div>
          <div>
            <label className={label}>Tester emails (comma separated)</label>
            <input className={field} value={(value('testerEmails') ?? []).join(', ')}
              onChange={(e) => set({ testerEmails: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            <p className="mt-1 text-xs text-zinc-600">In Testing mode, only these addresses get the offer.</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={value('requireVerifiedEmail') ?? true}
              onChange={(e) => set({ requireVerifiedEmail: e.target.checked })} />
            Require a confirmed email address
          </label>
          {value('requireVerifiedEmail') === false && (
            <p className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              With this off, anyone who guesses an invited customer&apos;s address can register it and
              take the offer without ever opening that inbox. Leave it on unless you have a specific reason.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={value('allowKarmaStacking') ?? false}
              onChange={(e) => set({ allowKarmaStacking: e.target.checked })} />
            Allow karma points on top of this discount
          </label>
        </div>
      </div>

      {/* Assignment only makes sense once a product ladder exists to assign into. */}
      {isProductMode && <ProductTierPanel campaignId={campaign._id} />}
      {/* The roster is the allowlist. An 'everyone' campaign does not consult it, and
          the rows are kept rather than deleted — they are the record of who the cards
          went to, so this is hidden, not destroyed. */}
      {isAllowlist && <MemberRosterPanel campaignId={campaign._id} />}
      <MemberImportPanel campaignId={campaign._id} slug={slug} />

      {/* ── Save ────────────────────────────────────────────────────────────── */}
      {saveError && (
        <p className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{saveError}</p>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate(draft ?? {})}
          disabled={!draft || save.isPending}
          className="rounded bg-gold px-5 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        {draft && (
          <button onClick={() => { setDraft(null); setSaveError(null); }} className="text-sm text-zinc-400 hover:text-white">
            Discard
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The PER-PRODUCT ladder: what each tier is worth, and which one is "everything else".
 *
 * Membership is not edited here — that is ProductTierPanel's job, and it is a different
 * kind of work (search, review, commit). This card owns only the definitions.
 *
 * The `code` field is deliberately read-only once saved. It is the key the assignment
 * rows point at, so renaming one strands every product in that tier: resolveLinePercent
 * finds nothing explicit and silently falls back to the default rate. The server refuses
 * it too — this input is disabled so the refusal is never a surprise.
 */
function ProductLadderCard({ tiers, setTier, setAll }: {
  tiers: ProductTier[];
  setTier: (i: number, patch: Partial<ProductTier>) => void;
  setAll: (next: ProductTier[]) => void;
}) {
  const defaultCount = tiers.filter((t) => t.isDefault).length;

  return (
    <div className={`${card} mb-6`}>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-400">Product tiers</h2>
      <p className="mb-4 text-xs text-zinc-500">
        Each line earns the rate of the tier its product is in. Where a product matches
        several tiers the <span className="text-zinc-300">lowest</span> rate wins, and anything
        already on offer is capped at 2%.
      </p>

      <div className="space-y-3">
        {tiers.map((t, i) => (
          <div key={t.code} className="grid grid-cols-2 gap-3 rounded border border-zinc-800 p-3 sm:grid-cols-5">
            <div>
              <label className={label}>Code</label>
              <input className={`${field} cursor-not-allowed opacity-60`} value={t.code} readOnly
                title="A tier's code is fixed: products are assigned against it." />
            </div>
            <div>
              <label className={label}>Label</label>
              <input className={field} value={t.label ?? ''}
                onChange={(e) => setTier(i, { label: e.target.value })} />
            </div>
            <div>
              <label className={label}>Percent off</label>
              <input type="number" className={field} value={t.percent ?? 0}
                onChange={(e) => setTier(i, { percent: Number(e.target.value) })} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <input type="radio" name="defaultTier" checked={!!t.isDefault}
                  onChange={() => setAll(tiers.map((x, j) => ({ ...x, isDefault: j === i })))} />
                Everything else
              </label>
            </div>
            <div className="flex items-end">
              {/* Removing a tier that still has products is refused server-side; the
                  button stays available so the operator gets that explanation rather
                  than a silently missing control. */}
              <button
                onClick={() => setAll(tiers.filter((_, j) => j !== i))}
                className="rounded p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                title="Remove tier"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {defaultCount !== 1 && (
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-400">
          <AlertTriangle size={13} />
          Exactly one tier must be “everything else”, or products in no tier earn nothing.
        </p>
      )}

      <button
        onClick={() => setAll([...tiers, { code: `tier${tiers.length + 1}`, label: '', percent: 5 }])}
        className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
      >
        <Plus size={14} /> Add a tier
      </button>
    </div>
  );
}

/**
 * What real products would earn right now — the calculator for a product-tier campaign.
 *
 * There is no cart value to type in: the rate follows the product. So this asks the
 * question that actually goes wrong, which is not "is the ladder right?" but "did the
 * products meant to be in a tier ever get assigned to it?". A tier can be perfectly
 * configured and completely empty, and nothing in the ladder shows that — only resolving
 * real products does. Every figure is the server's, resolved by the same function that
 * prices a cart line.
 */
function ProductCalculatorPanel({ campaignId }: { campaignId: string }) {
  const [input, setInput] = useState('');
  const [qty, setQty] = useState(1);

  const run = useMutation({
    mutationFn: () =>
      apiClient.get<{
        success: boolean;
        matched: number;
        unassignedCount: number;
        orderCapRupees: number | null;
        truncated: boolean;
        products: {
          id: string; name: string; price: number; tierLabel: string | null; percent: number;
          onSaleCapped: boolean; unassigned: boolean; savesRupees: number;
        }[];
      }>(API_ENDPOINTS.CAMPAIGN_PRODUCT_TIER_SIMULATE(campaignId), {
        params: { query: input.trim(), quantity: String(qty) },
      }),
  });

  return (
    <div className={`${card} mb-6`}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        <Calculator size={14} /> Calculator
      </h2>
      <p className="mb-4 text-xs text-zinc-500">
        Uses the SAVED ladder and the SAVED assignments — save first to test a change.
      </p>

      <div className="flex gap-3">
        <input className={field} value={input} placeholder="Search products, e.g. profender"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && input.trim()) run.mutate(); }} />
        <input type="number" min={1} max={999} value={qty} title="Quantity"
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          className={`${field} w-20 shrink-0`} />
        <button onClick={() => run.mutate()} disabled={!input.trim() || run.isPending}
          className="shrink-0 rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40">
          {run.isPending ? '…' : 'Resolve'}
        </button>
      </div>

      {run.isError && <p className="mt-3 text-sm text-red-400">{(run.error as Error).message}</p>}

      {run.data && (
        <>
          {run.data.unassignedCount > 0 && (
            /* The finding worth shouting about: these look identical to a deliberate
               "everything else" in the discount column. */
            <p className="mt-4 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {run.data.unassignedCount} of {run.data.matched} are in no tier and are taking
              the default rate. If they were meant to be in one, assign them below.
            </p>
          )}

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="pb-2">Product</th><th className="pb-2">Tier</th>
                <th className="pb-2">Rate</th><th className="pb-2">They save</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {run.data.products.map((p) => (
                <tr key={p.id} className="border-t border-zinc-800">
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">
                    {p.tierLabel ?? '—'}
                    {p.unassigned && <span className="ml-2 text-xs text-amber-400">unassigned</span>}
                  </td>
                  <td className="py-2">
                    {p.percent}%
                    {p.onSaleCapped && <span className="ml-2 text-xs text-zinc-500">capped, already on offer</span>}
                  </td>
                  <td className="py-2 text-emerald-400">{inr(p.savesRupees)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {run.data.orderCapRupees != null && (
            /* Stated because the column does NOT add up to what a cart of these would
               save — the order ceiling is applied across all lines together. */
            <p className="mt-3 text-xs text-zinc-600">
              Per item. A single order is capped at {inr(run.data.orderCapRupees)} across everything in it.
            </p>
          )}
          {run.data.truncated && (
            <p className="mt-2 text-xs text-zinc-600">Showing the first matches only — narrow the search to see the rest.</p>
          )}
        </>
      )}
    </div>
  );
}

/** What a given cart would earn — catches a mispriced ladder before a customer does. */
function SimulatorPanel({ campaignId }: { campaignId: string }) {
  const [input, setInput] = useState('25000, 50000, 100000, 150000, 200000, 300000, 500000');

  const run = useMutation({
    mutationFn: () =>
      apiClient.post<{ success: boolean; results: { cartRupees: number; discountRupees: number; label: string | null }[] }>(
        API_ENDPOINTS.CAMPAIGN_SIMULATE(campaignId),
        { cartValues: input.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) },
      ),
  });

  return (
    <div className={`${card} mb-6`}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        <Calculator size={14} /> Calculator
      </h2>
      <p className="mb-4 text-xs text-zinc-500">Uses the SAVED tiers — save first to test a change.</p>

      <div className="flex gap-3">
        <input className={field} value={input} onChange={(e) => setInput(e.target.value)} />
        <button onClick={() => run.mutate()} disabled={run.isPending}
          className="shrink-0 rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40">
          Calculate
        </button>
      </div>

      {run.data && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="pb-2">Cart</th><th className="pb-2">They save</th><th className="pb-2">Tier</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {run.data.results.map((r) => (
              <tr key={r.cartRupees} className="border-t border-zinc-800">
                <td className="py-2">{inr(r.cartRupees)}</td>
                <td className="py-2 text-emerald-400">{inr(r.discountRupees)}</td>
                <td className="py-2 text-zinc-500">{r.label ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {run.isError && <p className="mt-3 text-sm text-red-400">{(run.error as Error).message}</p>}
    </div>
  );
}

/** Paste the operations list. Upserts, so a corrected list is safe to re-import. */
function MemberImportPanel({ campaignId, slug }: { campaignId: string; slug: string }) {
  const [text, setText] = useState('');
  const queryClient = useQueryClient();

  const upload = useMutation({
    mutationFn: () => {
      // Accept "email" or "Name,email" per line — whichever the spreadsheet produced.
      const members = text.split('\n').map((line) => {
        const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0) return null;
        const email = parts.find((p) => p.includes('@'));
        if (!email) return null;
        const name = parts.find((p) => p !== email) ?? null;
        return { email, name };
      }).filter(Boolean);
      return apiClient.post<{ success: boolean; inserted: number; updated: number; accepted: number; rejected: { email: string; reason: string }[] }>(
        API_ENDPOINTS.CAMPAIGN_MEMBERS(campaignId), { members },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: campaignKeys.report(slug) });
      // Otherwise the roster keeps serving its cached pages and the newly
      // imported people appear nowhere until a hard reload.
      queryClient.invalidateQueries({ queryKey: campaignKeys.membersFor(campaignId) });
    },
  });

  return (
    <div className={`${card} mb-6`}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        <Upload size={14} /> Invited customers
      </h2>
      <p className="mb-4 text-xs text-zinc-500">
        One per line, as <span className="font-mono">email</span> or <span className="font-mono">Name,email</span>.
        Re-importing updates names without touching anyone&apos;s claim or redemption history.
      </p>

      <textarea
        className={`${field} h-32 font-mono text-xs`}
        placeholder={'Deepak Sewani,deepak@example.com\nanother@example.com'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button onClick={() => upload.mutate()} disabled={!text.trim() || upload.isPending}
        className="mt-3 rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-40">
        {upload.isPending ? 'Importing…' : 'Import'}
      </button>

      {upload.data && (
        <div className="mt-3 text-sm text-zinc-300">
          <p>{upload.data.inserted} added, {upload.data.updated} updated.</p>
          {upload.data.rejected.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-amber-400">
              {upload.data.rejected.map((r, i) => <li key={i}>{r.email || '(blank)'} — {r.reason}</li>)}
            </ul>
          )}
        </div>
      )}
      {upload.isError && <p className="mt-3 text-sm text-red-400">{(upload.error as Error).message}</p>}
    </div>
  );
}
