'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

/**
 * Compact karma balance pill shown beside the user's name on the profile header.
 * Self-contained; renders nothing while loading, on error, or when loyalty is disabled.
 * The full balance + ledger history live in {@link KarmaCard}.
 */
export default function KarmaBadge() {
  const [balance, setBalance] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    apiClient
      .get<{ success: boolean; balance: number; config: { enabled: boolean } }>(API_ENDPOINTS.LOYALTY_ME)
      .then((r) => {
        setBalance(r.balance);
        setEnabled(r.config.enabled);
      })
      .catch(() => setBalance(null));
  }, []);

  if (balance === null || !enabled) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-display font-bold uppercase tracking-widest text-gold"
      title="Karma points"
    >
      <Sparkles className="h-3.5 w-3.5" />
      {balance} pts
    </span>
  );
}
