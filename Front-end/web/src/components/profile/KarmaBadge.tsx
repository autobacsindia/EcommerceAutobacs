'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { profileKeys } from '@/hooks/queries/keys';

interface LedgerEntry {
  _id: string;
  type: 'earn' | 'redeem' | 'reverse' | 'expire' | 'adjust';
  points: number;
  balanceAfter: number;
  description?: string;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  earn: 'Earned', redeem: 'Redeemed', reverse: 'Reversed', expire: 'Expired', adjust: 'Adjusted',
};

/**
 * Karma balance shown on the right of the profile identity header. The chevron
 * expands the ledger history in a dropdown (loaded lazily on first open).
 * Self-contained; renders nothing while loading, on error, or when loyalty is
 * disabled.
 */
export default function KarmaBadge() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Balance + config via TanStack Query so it's cached across navigations. This
  // was a per-mount useEffect fetch, which re-loaded the badge on every profile
  // visit and flashed it in.
  const { data: karma } = useQuery({
    queryKey: profileKeys.karma(),
    queryFn: () =>
      apiClient.get<{ success: boolean; balance: number; config: { enabled: boolean; pointValueInRupees: number } }>(
        API_ENDPOINTS.LOYALTY_ME,
      ),
  });

  // Ledger history: fetched only once the dropdown is first opened (enabled:open),
  // then cached — reopening or revisiting doesn't refetch.
  const { data: entries } = useQuery({
    queryKey: profileKeys.karmaHistory(),
    queryFn: () =>
      apiClient
        .get<{ success: boolean; entries: LedgerEntry[] }>(API_ENDPOINTS.LOYALTY_HISTORY)
        .then((r) => r.entries || []),
    enabled: open,
  });

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const balance = karma?.balance ?? null;
  const pointValue = karma?.config.pointValueInRupees ?? 1;
  const loyaltyEnabled = karma?.config.enabled ?? false;

  const toggle = () => setOpen((v) => !v);

  if (balance === null || !loyaltyEnabled) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="Karma points, view history"
        title="Karma points"
        className="flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-gold hover:bg-gold/20 transition-colors"
      >
        <Sparkles className="h-4 w-4" />
        <span className="text-sm font-display font-bold uppercase tracking-widest">{balance} pts</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-3rem)] z-20 bg-obsidian border border-hairline rounded-lg p-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-hairline pb-3 mb-3">
            <div>
              <p className="text-xs font-display font-bold text-ink-muted uppercase tracking-widest">Karma Points</p>
              <p className="text-xl font-display font-bold text-ink">{balance}</p>
            </div>
            <p className="text-xs text-ink-muted font-display">≈ ₹{(balance * pointValue).toFixed(2)}</p>
          </div>
          {entries === undefined ? (
            <p className="text-ink-muted font-display text-sm">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-ink-muted font-display text-sm">No karma activity yet.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {entries.map((e) => (
                <div key={e._id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-ink/70 font-display font-bold uppercase tracking-wide text-xs">{TYPE_LABEL[e.type] || e.type}</span>
                    <span className="text-ink-muted font-display ml-2">{new Date(e.createdAt).toLocaleDateString()}</span>
                  </div>
                  <span className={`font-display font-bold ${e.points >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {e.points >= 0 ? '+' : ''}{e.points} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
