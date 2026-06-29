'use client';

import { useEffect, useState } from 'react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';

interface LoyaltyConfig {
  enabled: boolean;
  earnRatePercent: number;
  pointsExpiryDays: number | null;
  pointValueInRupees: number;
  redeemMaxPercent: number;
  minRedeemPoints: number;
}

const label = 'block text-sm font-medium text-gray-700 mb-1';
const input = 'w-full border border-gray-300 rounded-lg px-3 py-2';

export default function AdminLoyaltyPage() {
  const [cfg, setCfg] = useState<LoyaltyConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<{ success: boolean; config: LoyaltyConfig }>(API_ENDPOINTS.LOYALTY_CONFIG)
      .then(r => setCfg(r.config))
      .catch(err => setError(err.message || 'Failed to load config'));
  }, []);

  const set = <K extends keyof LoyaltyConfig>(k: K, v: LoyaltyConfig[K]) => setCfg(prev => prev ? { ...prev, [k]: v } : prev);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      await apiClient.put(API_ENDPOINTS.LOYALTY_CONFIG, {
        enabled: cfg.enabled,
        earnRatePercent: Number(cfg.earnRatePercent),
        pointsExpiryDays: cfg.pointsExpiryDays === null ? null : Number(cfg.pointsExpiryDays),
        pointValueInRupees: Number(cfg.pointValueInRupees),
        redeemMaxPercent: Number(cfg.redeemMaxPercent),
        minRedeemPoints: Number(cfg.minRedeemPoints),
      });
      setMsg('Saved. Changes apply to future earning and redemption.');
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (error && !cfg) return <div className="p-8 text-red-600">{error}</div>;
  if (!cfg) return <div className="p-8">Loading…</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Karma Points Settings</h1>
      <p className="text-gray-500 mb-6 max-w-2xl text-sm">
        Changing the point value or earn rate affects only future earning and redemption — existing balances are unchanged.
      </p>

      <form onSubmit={save} className="max-w-2xl space-y-5 bg-white p-6 rounded-lg shadow">
        {msg && <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-sm">{msg}</div>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Programme enabled
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>₹ value of 1 point</label>
            <input type="number" min={0} step="0.01" className={input} value={cfg.pointValueInRupees} onChange={(e) => set('pointValueInRupees', Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Earn rate (% of order subtotal, on delivery)</label>
            <input type="number" min={0} max={100} step="0.1" className={input} value={cfg.earnRatePercent} onChange={(e) => set('earnRatePercent', Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Max % of order redeemable</label>
            <input type="number" min={0} max={100} className={input} value={cfg.redeemMaxPercent} onChange={(e) => set('redeemMaxPercent', Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Minimum points to redeem</label>
            <input type="number" min={0} className={input} value={cfg.minRedeemPoints} onChange={(e) => set('minRedeemPoints', Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Points expiry (days, blank = never)</label>
            <input
              type="number" min={0} className={input}
              value={cfg.pointsExpiryDays ?? ''}
              onChange={(e) => set('pointsExpiryDays', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
        </div>

        <button type="submit" disabled={saving} className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </div>
  );
}
