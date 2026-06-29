'use client';

import { useEffect, useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

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

/** Karma balance + ledger history card for the profile page. Self-contained. */
export default function KarmaCard() {
  const [balance, setBalance] = useState<number | null>(null);
  const [pointValue, setPointValue] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    apiClient.get<{ success: boolean; balance: number; config: { enabled: boolean; pointValueInRupees: number } }>(API_ENDPOINTS.LOYALTY_ME)
      .then(r => { setBalance(r.balance); setPointValue(r.config.pointValueInRupees); setEnabled(r.config.enabled); })
      .catch(() => setBalance(0));
  }, []);

  const loadHistory = () => {
    if (!showHistory && entries.length === 0) {
      apiClient.get<{ success: boolean; entries: LedgerEntry[] }>(API_ENDPOINTS.LOYALTY_HISTORY)
        .then(r => setEntries(r.entries || []))
        .catch(() => setEntries([]));
    }
    setShowHistory(v => !v);
  };

  if (balance === null || !enabled) return null;

  return (
    <div className="bg-[#0E0E0E] border border-[#252525] rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#3B9EE8]/10 border border-[#3B9EE8]/30 rounded-full flex items-center justify-center shrink-0">
            <Sparkles className="h-6 w-6 text-[#3B9EE8]" />
          </div>
          <div>
            <p className="text-xs font-condensed font-bold text-[#555555] uppercase tracking-widest">Karma Points</p>
            <p className="text-2xl font-condensed font-bold text-white">{balance}</p>
            <p className="text-xs text-[#555555] font-body">≈ ₹{(balance * pointValue).toFixed(2)} value</p>
          </div>
        </div>
        <button
          onClick={loadHistory}
          className="text-[#3B9EE8] hover:text-white font-condensed font-bold uppercase tracking-widest text-xs flex items-center gap-1 transition-colors"
        >
          History {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {showHistory && (
        <div className="mt-4 border-t border-[#252525] pt-4 space-y-2">
          {entries.length === 0 ? (
            <p className="text-[#555555] font-body text-sm">No karma activity yet.</p>
          ) : entries.map((e) => (
            <div key={e._id} className="flex items-center justify-between text-sm">
              <div>
                <span className="text-[#C4C4C4] font-condensed font-bold uppercase tracking-wide text-xs">{TYPE_LABEL[e.type] || e.type}</span>
                <span className="text-[#555555] font-body ml-2">{new Date(e.createdAt).toLocaleDateString()}</span>
              </div>
              <span className={`font-condensed font-bold ${e.points >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {e.points >= 0 ? '+' : ''}{e.points} pts
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
