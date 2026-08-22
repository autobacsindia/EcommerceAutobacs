'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Power, PlayCircle, FileEdit, Users, IndianRupee } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { campaignKeys } from '@/hooks/queries/keys';

/**
 * Admin — promotional campaigns.
 *
 * The list doubles as the control panel: the status control is here rather than buried
 * in the editor because turning a live offer OFF is the one action an operator may need
 * to take in a hurry, and it must never be more than one click away.
 */

/*
  `testing` was a fourth state that ran the campaign on the real site for a list of named
  tester emails. Removed — the test ENVIRONMENT already gives that separation, with its
  own database and Razorpay keys, so 'live' means live for whichever environment you are
  looking at. Keeping both produced a switch an operator could turn on and correctly see
  nothing happen.
*/
type CampaignStatus = 'draft' | 'live' | 'off';

interface CampaignRow {
  _id: string;
  slug: string;
  name: string;
  status: CampaignStatus;
  audience: 'list' | 'everyone';
  startsAt: string | null;
  endsAt: string | null;
  couponCode: string | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  discountGivenRupees: number;
}

const STATUS_STYLES: Record<CampaignStatus, string> = {
  live: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
  draft: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30',
  off: 'bg-red-500/15 text-red-400 ring-red-500/30',
};

const STATUS_ICON: Record<CampaignStatus, typeof Power> = {
  live: PlayCircle, draft: FileEdit, off: Power,
};

const inr = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;
const day = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';

export default function AdminCampaignsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: campaignKeys.lists(),
    queryFn: () => apiClient.get<{ success: boolean; campaigns: CampaignRow[] }>(API_ENDPOINTS.CAMPAIGNS),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CampaignStatus }) =>
      apiClient.patch(API_ENDPOINTS.CAMPAIGN_STATUS(id), { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });

  const campaigns = data?.campaigns ?? [];

  if (isLoading) return <div className="p-8 text-zinc-400">Loading campaigns…</div>;
  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-400">Could not load campaigns: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Campaigns</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Occasion-based offers. A campaign decides who qualifies and how much they get;
          changing it here takes effect immediately, and never alters an order already placed.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center text-zinc-400">
          No campaigns yet.
        </p>
      ) : (
        <div className="space-y-4">
          {campaigns.map((c) => {
            const Icon = STATUS_ICON[c.status];
            const capReached = c.maxRedemptions != null && c.redeemedCount >= c.maxRedemptions;
            const nearCap = c.maxRedemptions != null && !capReached
              && c.redeemedCount >= c.maxRedemptions * 0.8;

            return (
              <div key={c._id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <Link href={`/admin/campaigns/${c.slug}`} className="text-lg font-semibold text-white hover:text-gold">
                        {c.name}
                      </Link>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLES[c.status]}`}>
                        <Icon size={12} />
                        {c.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {c.audience === 'list' ? 'Invited customers only' : 'Everyone'}
                      {c.couponCode && <> · code <span className="font-mono text-zinc-400">{c.couponCode}</span></>}
                      <> · {day(c.startsAt)} → {day(c.endsAt)}</>
                    </p>
                  </div>

                  {/* One-click stop. Deliberately not hidden behind the editor. */}
                  <div className="flex items-center gap-2">
                    {(['live', 'off'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus.mutate({ id: c._id, status: s })}
                        disabled={setStatus.isPending || c.status === s}
                        className={`rounded px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                          c.status === s
                            ? 'bg-zinc-700 text-white'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        {s === 'off' ? 'Turn off' : 'Go live'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-6 border-t border-zinc-800 pt-4 text-sm">
                  <span className="flex items-center gap-2 text-zinc-400">
                    <Users size={14} />
                    <span className="text-white">{c.redeemedCount}</span>
                    {c.maxRedemptions != null && <span>/ {c.maxRedemptions}</span>} redeemed
                  </span>
                  <span className="flex items-center gap-2 text-zinc-400">
                    <IndianRupee size={14} />
                    <span className="text-white">{inr(c.discountGivenRupees)}</span> given away
                  </span>
                  {capReached && (
                    <span className="text-red-400">Cap reached — the offer has closed itself</span>
                  )}
                  {nearCap && (
                    <span className="text-amber-400">Approaching the redemption cap</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {setStatus.isError && (
        <p className="mt-4 text-sm text-red-400">
          {(setStatus.error as Error).message}
        </p>
      )}
    </div>
  );
}
