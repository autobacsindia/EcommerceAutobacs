'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTimeIST } from '@/lib/datetime';
import type { SpinCampaign, SpinStatus } from '@/types/spin';

/**
 * Admin — Spin-to-Win campaigns.
 *
 * A campaign decides WHEN the wheel is offered and to WHICH orders. It holds no stock
 * and no odds; those live on the prizes inside it, so goodies can be added or restocked
 * without touching the campaign.
 *
 * Campaigns are always created as `draft`. Going live is a separate, gated action on the
 * detail screen — a malformed campaign can never start handing out prizes just because
 * someone hit Save.
 */

const STATUS_STYLE: Record<SpinStatus, string> = {
  live: 'bg-green-100 text-green-800',
  draft: 'bg-gray-100 text-gray-700',
  off: 'bg-red-100 text-red-700',
};

const STATUS_HINT: Record<SpinStatus, string> = {
  live: 'Running — customers are spinning',
  draft: 'Being set up. Does nothing yet.',
  off: 'Switched off. No wheel appears.',
};

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in LOCAL time, not an ISO Z string. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const emptyForm = () => {
  const now = new Date();
  const inAMonth = new Date(now.getTime() + 30 * 86400000);
  return {
    slug: '',
    name: '',
    startsAt: toLocalInput(now.toISOString()),
    endsAt: toLocalInput(inAMonth.toISOString()),
    goodieWinRatePercent: 20,
    segmentCount: 8,
    maxSpinsPerUserPerCampaign: 1 as number | null,
    // Rupees in the input, paise on the wire — matching the prize form's convention.
    minOrderValueRupees: 0,
    reviewCtaEnabled: true,
    reviewCtaHeadline: 'Loved your order?',
    reviewCtaUrl: '',
    terms: '',
  };
};

export default function SpinCampaignsPage() {
  const [campaigns, setCampaigns] = useState<SpinCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ success: boolean; campaigns: SpinCampaign[] }>(
        API_ENDPOINTS.SPIN_CAMPAIGNS_ADMIN,
      );
      setCampaigns(res.campaigns ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.post(API_ENDPOINTS.SPIN_CAMPAIGNS_ADMIN, {
        slug: form.slug.trim(),
        name: form.name.trim(),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        goodieWinRatePercent: Number(form.goodieWinRatePercent),
        minOrderValuePaise: Math.round(Number(form.minOrderValueRupees || 0) * 100),
        segmentCount: Number(form.segmentCount),
        maxSpinsPerUserPerCampaign: form.maxSpinsPerUserPerCampaign,
        reviewCta: {
          enabled: form.reviewCtaEnabled,
          headline: form.reviewCtaHeadline || null,
          url: form.reviewCtaUrl.trim() || null,
        },
        terms: form.terms.trim() || null,
      });
      setMsg('Campaign created as a draft. Add prizes, then publish it.');
      setShowForm(false);
      setForm(emptyForm());
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🎡 Spin to Win</h1>
          <p className="mt-1 text-sm text-gray-600">
            A reward after every paid order. Everyone wins something — odds follow your
            stock automatically, so you never type a percentage.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ New campaign'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{msg}</div>}

      {showForm && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 font-semibold text-gray-900">New campaign</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Diwali 2026"
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Slug (url-safe, unique)</span>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="diwali-2026"
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Starts</span>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Ends</span>
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Real-goodie win rate: {form.goodieWinRatePercent}%
              </span>
              <input
                type="range" min={1} max={100}
                value={form.goodieWinRatePercent}
                onChange={(e) => setForm({ ...form, goodieWinRatePercent: Number(e.target.value) })}
                className="w-full"
              />
              <span className="mt-1 block text-xs text-gray-500">
                Roughly {form.goodieWinRatePercent} in 100 customers win a physical goodie.
                The rest get your guaranteed fallback prize. 100% = goodies until stock runs out.
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Minimum order to spin <span className="font-normal text-gray-500">(₹, 0 = no minimum)</span>
              </span>
              <input
                type="number" min={0}
                value={form.minOrderValueRupees}
                onChange={(e) => setForm({ ...form, minOrderValueRupees: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
              {/*
                Campaign-wide gate on whether the wheel appears at all — distinct from
                the per-prize minimum, which only decides which prizes are in the pool.
              */}
              <span className="mt-1 block text-xs text-gray-500">
                Below this the customer sees no wheel. Set per-prize minimums separately to
                keep the expensive prizes off small orders.
              </span>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-gray-700">Spins per customer</span>
              <select
                value={form.maxSpinsPerUserPerCampaign === null ? 'null' : String(form.maxSpinsPerUserPerCampaign)}
                onChange={(e) => setForm({
                  ...form,
                  maxSpinsPerUserPerCampaign: e.target.value === 'null' ? null : Number(e.target.value),
                })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                <option value="1">1 per customer for the whole campaign</option>
                <option value="2">2 per customer</option>
                <option value="3">3 per customer</option>
                <option value="null">Unlimited — every order earns a spin</option>
              </select>
              <span className="mt-1 block text-xs text-gray-500">
                An order can only ever be spun once regardless. This caps the person.
              </span>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">Google review link (optional)</span>
              <input
                value={form.reviewCtaUrl}
                onChange={(e) => setForm({ ...form, reviewCtaUrl: e.target.value })}
                placeholder="https://search.google.com/local/writereview?placeid=..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
              <span className="mt-1 block text-xs text-gray-500">
                Shown <strong>after</strong> the prize is already won, and skippable. It never
                changes what someone wins — Google prohibits rewarding reviews, and gating a
                prize on one risks your existing reviews being removed.
              </span>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">Terms &amp; conditions (optional)</span>
              <textarea
                value={form.terms}
                onChange={(e) => setForm({ ...form, terms: e.target.value })}
                rows={3}
                placeholder="One spin per customer. Prizes subject to availability…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
          </div>
          <button
            onClick={save}
            disabled={saving || !form.slug.trim() || !form.name.trim()}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create as draft'}
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Window</th>
              <th className="px-4 py-3 text-right">Goodie rate</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Loading…</td></tr>
            )}
            {!loading && campaigns.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                No campaigns yet. Create one to get started.
              </td></tr>
            )}
            {campaigns.map((c) => (
              <tr key={c._id} className="border-t border-gray-100">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{c.name}</div>
                  <div className="text-xs text-gray-500">{c.slug}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[c.status]}`}>
                    {c.status}
                  </span>
                  <div className="mt-0.5 text-[11px] text-gray-500">{STATUS_HINT[c.status]}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  <div>{formatDateTimeIST(c.startsAt)}</div>
                  <div className="text-xs text-gray-400">to {formatDateTimeIST(c.endsAt)}</div>
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{c.goodieWinRatePercent}%</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/spin/${c._id}`} className="text-blue-600 hover:underline">
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
