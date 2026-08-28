'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import SpinGauge from '@/components/spin/SpinGauge';
import type { SpinCampaign, SpinPrize } from '@/types/spin';

/**
 * Stand-in artwork for when no campaign is selected. Inline SVG, so the harness needs no
 * network and no Cloudinary account. Real prize pictures are photographs, which crop and
 * read very differently from flat icons — load a real campaign to judge the real thing.
 */
const icon = (bg: string, art: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${bg}"/>${art}</svg>`,
  )}`;

const SAMPLE = [
  { label: 'Autobacs Tee', art: icon('#f2f4f7', '<path d="M17 12l-7 4 3 6 3-1.5V37h16V20.5l3 1.5 3-6-7-4-4 3h-6z" fill="#2a4a73"/>') },
  { label: 'Travel Mug', art: icon('#fff3e0', '<path d="M13 16h18v14a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7z" fill="#8a5a2b"/><path d="M31 20h4a4 4 0 0 1 0 8h-4z" fill="none" stroke="#8a5a2b" stroke-width="2.5"/>') },
  { label: 'Keychain', art: icon('#e8f0fe', '<circle cx="19" cy="20" r="7" fill="none" stroke="#1e3a5f" stroke-width="4"/><path d="M24 24l11 11m-4 0l4 0 0-4" fill="none" stroke="#1e3a5f" stroke-width="4"/>') },
  { label: 'Dashcam', art: icon('#eceff1', '<rect x="9" y="16" width="22" height="16" rx="3" fill="#37474f"/><path d="M31 21l8-4v14l-8-4z" fill="#37474f"/><circle cx="20" cy="24" r="4" fill="#90a4ae"/>') },
  { label: 'Racing Cap', art: icon('#fdecef', '<path d="M10 30a14 14 0 0 1 28 0z" fill="#c62828"/><path d="M8 30h32v4H8z" fill="#8e0000"/>') },
  { label: 'Bottle', art: icon('#e8f5e9', '<path d="M21 10h6v5l3 5v18a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V20l3-5z" fill="#2e7d32"/><rect x="20" y="24" width="8" height="5" fill="#a5d6a7"/>') },
  { label: '10% OFF', art: null },
  { label: '5% OFF', art: null },
];

type Slice = { label: string; art: string | null };

/** Fisher-Yates, mirroring the shuffle the server does so a preview layout looks typical. */
const shuffled = <T,>(arr: T[]): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export default function SpinPreviewClient() {
  const params = useSearchParams();
  const campaignId = params.get('campaign');

  const [campaign, setCampaign] = useState<SpinCampaign | null>(null);
  const [prizes, setPrizes] = useState<SpinPrize[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(campaignId));

  const [count, setCount] = useState(6);
  const [showArt, setShowArt] = useState(true);
  const [custom, setCustom] = useState('');
  const [seed, setSeed] = useState(0);
  const [winningIndex, setWinningIndex] = useState<number | null>(null);
  const [spinning, setSpinning] = useState(false);

  // Real prizes, fetched with the ADMIN's own session. A non-admin visitor gets a 401
  // here and falls back to the sample wheel — no prize data leaks to a stranger who
  // guesses the URL, which is why this fetches rather than being server-rendered.
  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    (async () => {
      try {
        const [prizeRes, listRes] = await Promise.all([
          apiClient.get<{ prizes: SpinPrize[] }>(API_ENDPOINTS.SPIN_CAMPAIGN_PRIZES(campaignId)),
          apiClient.get<{ campaigns: SpinCampaign[] }>(API_ENDPOINTS.SPIN_CAMPAIGNS_ADMIN),
        ]);
        if (cancelled) return;
        const found = (listRes.campaigns || []).find((c) => c._id === campaignId) || null;
        setCampaign(found);
        setPrizes(prizeRes.prizes || []);
        if (found?.segmentCount) setCount(found.segmentCount);
      } catch {
        if (!cancelled) setLoadError('Could not load that campaign. Sign in as an admin, then reload.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  // Only ACTIVE prizes can appear on a real wheel, so an inactive one must not appear
  // here either — otherwise the preview would show a prize no customer can ever win.
  const pool: Slice[] = prizes
    ? prizes.filter((p) => p.active).map((p) => ({ label: p.shortLabel || p.name, art: p.imageUrl }))
    : SAMPLE;

  const buildSlices = useCallback((): Slice[] => {
    if (pool.length === 0) return [];
    const picked = shuffled(pool).slice(0, count);
    // Pool smaller than the wheel → the server cycles prizes so no slice is blank.
    while (picked.length < count) picked.push(pool[picked.length % pool.length]);
    return picked;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prizes, count, seed]);

  const [slices, setSlices] = useState<Slice[]>([]);
  useEffect(() => { setSlices(buildSlices()); setWinningIndex(null); }, [buildSlices]);

  const labels = slices.map((s) => s.label);
  const pasted = custom.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const images = showArt ? slices.map((s, i) => pasted[i] ?? s.art) : [];

  const spin = () => {
    // PREVIEW ONLY. The real winner is chosen by the server inside a transaction that
    // decrements physical stock, and SpinGauge is deliberately incapable of choosing
    // anything itself. This local random drives the animation and is exactly the thing
    // that must never appear in the real component.
    setWinningIndex(null);
    setSpinning(true);
    setTimeout(() => {
      setWinningIndex(Math.floor(Math.random() * (labels.length || 1)));
      setSpinning(false);
    }, 1200);
  };

  const usingReal = Boolean(campaignId) && !loadError && prizes !== null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Internal preview — not a real spin.</strong> This renders the same wheel
        component the customer sees, so it shows how the wheel <em>looks</em>. It proves
        nothing about eligibility, prize stock, or whether a paid order actually offers a
        spin. Hidden in production.
      </div>

      {loading && <p className="py-10 text-center text-gray-500">Loading campaign…</p>}
      {loadError && (
        <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      )}

      {!loading && (
        <>
          <p className="mb-2 text-sm text-gray-600">
            {usingReal
              ? <>Showing <strong>{campaign?.name ?? 'this campaign'}</strong> — {pool.length} active prize{pool.length === 1 ? '' : 's'}, {count} slices.</>
              : <>Showing <strong>sample prizes</strong>. Open this from a campaign in
                {' '}<Link href="/admin/spin" className="underline">Admin → Spin</Link> to preview its real prizes and artwork.</>}
          </p>

          <div className="rounded-2xl bg-[#060d18] p-4">
            <SpinGauge
              labels={labels}
              images={images}
              winningIndex={winningIndex}
              spinning={spinning}
              onSettled={() => {}}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button onClick={spin} disabled={spinning || labels.length === 0}
              className="rounded-full bg-[#f5b32c] px-6 py-2 font-bold text-[#1a1205] disabled:opacity-50">
              {spinning ? 'Spinning…' : 'Spin'}
            </button>
            <button onClick={() => setSeed((s) => s + 1)} className="rounded-full border px-4 py-2 text-sm">
              Reshuffle layout
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showArt} onChange={(e) => setShowArt(e.target.checked)} />
              Show artwork
            </label>
            <label className="flex items-center gap-2 text-sm">
              Slices
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}
                className="rounded border px-2 py-1">
                {[4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            The real wheel picks its slices per spin — weighted by stock, then shuffled —
            so the layout below is <em>one</em> possible arrangement, not a fixed one.
            &ldquo;Reshuffle&rdquo; shows another. Which slice wins here is random and means nothing;
            in production the server decides before the needle moves.
          </p>

          <div className="mt-5">
            <label className="block text-sm font-semibold">
              Try artwork before uploading it
              <span className="ml-1 font-normal text-gray-500">
                — paste image URLs, comma or space separated, applied left to right
              </span>
            </label>
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="https://res.cloudinary.com/…/tshirt.jpg, https://…/mug.jpg"
              className="mt-1 w-full rounded border px-3 py-2 font-mono text-xs"
            />
            <p className="mt-1 text-xs text-gray-500">
              Icons are clipped to a circle, so square images crop best. A URL that fails
              to load paints nothing — the text label stays, which is the intended fallback.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
