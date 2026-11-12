'use client';

import { useEffect, useState } from 'react';
import { Trophy, Download, X } from 'lucide-react';
import { useIncentiveChampion } from '@/hooks/queries/useIncentives';
import { monthLabel, points, rupees, type Champion } from '@/lib/incentives';

/**
 * Last month's Incentive Champion, at the top of the staff panel for the first
 * days of the month (the server decides which days: `showBanner`). Dismissable
 * per month on this device. "Share image" draws a 1080×1080 PNG in the browser —
 * nothing is uploaded.
 */
const dismissKey = (month: string) => `roav-champion-dismissed:${month}`;

export function drawChampionImage(c: Champion): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1080;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  const bg = g.createLinearGradient(0, 0, 1080, 1080);
  bg.addColorStop(0, '#111827'); bg.addColorStop(1, '#7c2d12');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1080);
  g.fillStyle = '#facc15'; g.textAlign = 'center';
  g.font = 'bold 54px system-ui, sans-serif';
  g.fillText('INCENTIVE CHAMPION', 540, 200);
  g.fillStyle = '#e5e7eb'; g.font = '40px system-ui, sans-serif';
  g.fillText(monthLabel(c.month), 540, 270);
  g.font = '220px system-ui, sans-serif';
  g.fillText('🏆', 540, 540);
  g.fillStyle = '#ffffff'; g.font = 'bold 84px system-ui, sans-serif';
  g.fillText(c.name.slice(0, 22), 540, 690);
  g.fillStyle = '#facc15'; g.font = 'bold 60px system-ui, sans-serif';
  g.fillText(`${points(c.finalPoints)} Roav Points`, 540, 790);
  g.fillStyle = '#e5e7eb'; g.font = '46px system-ui, sans-serif';
  g.fillText(`${c.slab ? `${c.slab} slab · ` : ''}${rupees(c.payout)}`, 540, 870);
  g.font = '32px system-ui, sans-serif'; g.fillStyle = '#9ca3af';
  g.fillText('Roavion · Autobacs India', 540, 1000);
  return canvas;
}

export default function ChampionBanner() {
  const { data: champion } = useIncentiveChampion();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    if (!champion) return;
    try { setHidden(localStorage.getItem(dismissKey(champion.month)) === '1'); } catch { setHidden(false); }
  }, [champion]);

  if (!champion?.showBanner || hidden) return null;

  const download = () => {
    const url = drawChampionImage(champion).toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = `incentive-champion-${champion.month}.png`; a.click();
  };
  const dismiss = () => {
    try { localStorage.setItem(dismissKey(champion.month), '1'); } catch { /* private mode: just hide */ }
    setHidden(true);
  };

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-yellow-300 bg-gradient-to-r from-yellow-50 to-amber-100 px-4 py-3 text-sm text-gray-900">
      <Trophy className="h-6 w-6 shrink-0 text-yellow-600" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <b>{monthLabel(champion.month)} Incentive Champion: {champion.name}</b>
        <span className="block text-gray-700 sm:inline sm:pl-2">{points(champion.finalPoints)} pts · {rupees(champion.payout)}{champion.slab ? ` · ${champion.slab}` : ''}</span>
      </p>
      <button onClick={download} className="inline-flex items-center gap-1 rounded-lg bg-yellow-600 px-3 py-1.5 font-medium text-white hover:bg-yellow-700">
        <Download className="h-4 w-4" aria-hidden="true" /> Share image
      </button>
      <button onClick={dismiss} aria-label="Hide" className="rounded p-1 text-gray-500 hover:bg-yellow-200"><X className="h-4 w-4" /></button>
    </div>
  );
}
