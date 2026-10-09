'use client';

import { useMemo, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Search } from 'lucide-react';
import { computeSeoScore, seoRating, type SeoData } from '@/lib/seoScore';

// Scoring lives in lib/seoScore so the admin Products list shows the same number.
export type { SeoData };

// ── Component ───────────────────────────────────────────────────────────────

export default function SeoScorePanel({ data }: { data: SeoData }) {
  const [focusKeyword, setFocusKeyword] = useState('');

  const { score, groups } = useMemo(() => computeSeoScore(data, focusKeyword), [data, focusKeyword]);

  const scoreColor   = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
  const scoreLabel   = seoRating(score).label;
  const scoreLabelCls = score >= 70 ? 'text-green-600' : score >= 40 ? 'text-amber-500' : 'text-red-500';

  const radius       = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset   = circumference - (score / 100) * circumference;

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">SEO Score</h2>

      {/* ── Focus Keyword input ── */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Focus Keyword
        </label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
          <input
            type="text"
            value={focusKeyword}
            onChange={(e) => setFocusKeyword(e.target.value)}
            placeholder="e.g. toyota fortuner body kit"
            className="w-full pl-7 pr-3 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white placeholder:text-gray-400"
          />
        </div>
        <p className="text-[10px] text-gray-500 mt-1">
          {focusKeyword.trim()
            ? 'Keyword checks active — 20 bonus points included in score'
            : 'Enter a keyword to unlock +20 keyword-specific checks'}
        </p>
      </div>

      {/* ── Score circle ── */}
      <div className="flex flex-col items-center py-1">
        <svg width="104" height="104" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
          <circle
            cx="50" cy="50" r={radius}
            fill="none"
            stroke={scoreColor}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
          <text x="50" y="46" textAnchor="middle" dominantBaseline="middle" fontSize="22" fontWeight="bold" fill={scoreColor}>
            {score}
          </text>
          <text x="50" y="63" textAnchor="middle" fontSize="9" fill="#9ca3af">/ 100</text>
        </svg>
        <span className={`text-sm font-semibold mt-1 ${scoreLabelCls}`}>{scoreLabel}</span>
        <span className="text-[10px] text-gray-500 mt-0.5">Updates live as you fill the form</span>
      </div>

      {/* ── Check groups ── */}
      <div className="space-y-2">
        {groups.map(group => {
          const groupEarned   = group.checks.reduce((s, c) => s + c.earned,   0);
          const groupPossible = group.checks.reduce((s, c) => s + c.possible, 0);
          const allPassed     = groupEarned === groupPossible;

          return (
            <details
              key={group.title}
              className={`border rounded-md overflow-hidden ${group.isKeywordGroup ? 'border-blue-200' : 'border-gray-200'}`}
              open
            >
              <summary className={`flex items-center justify-between px-3 py-2 text-xs font-semibold cursor-pointer select-none list-none
                ${group.isKeywordGroup
                  ? allPassed ? 'bg-blue-50 text-blue-600' : 'bg-blue-50 text-blue-600'
                  : allPassed ? 'bg-green-50 text-green-700' : 'bg-white text-gray-700'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {group.isKeywordGroup && (
                    <Search className="h-3 w-3 shrink-0" />
                  )}
                  {group.title}
                </span>
                <span className={`ml-2 shrink-0 ${allPassed ? (group.isKeywordGroup ? 'text-blue-600' : 'text-green-600') : 'text-gray-500'}`}>
                  {groupEarned}/{groupPossible}
                </span>
              </summary>

              <div className="divide-y divide-gray-200">
                {group.checks.map(check => {
                  const passed  = check.earned === check.possible;
                  const partial = check.earned > 0 && !passed;

                  return (
                    <div key={check.label} className="px-3 py-2 flex items-start gap-2">
                      <span className="mt-0.5 shrink-0">
                        {passed
                          ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                          : partial
                            ? <AlertCircle className="h-3.5 w-3.5 text-amber-700" />
                            : <XCircle className="h-3.5 w-3.5 text-red-600" />
                        }
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 leading-snug">{check.label}</p>
                        {check.tip && (
                          <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{check.tip}</p>
                        )}
                      </div>
                      <span className={`text-[10px] font-medium shrink-0
                        ${passed ? 'text-green-600' : partial ? 'text-amber-500' : 'text-red-600'}`}
                      >
                        {check.earned}/{check.possible}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}

        {/* Placeholder when no keyword yet */}
        {!focusKeyword.trim() && (
          <div className="border border-dashed border-blue-200 rounded-md px-3 py-4 text-center">
            <Search className="h-4 w-4 text-blue-600 mx-auto mb-1.5" />
            <p className="text-xs text-gray-500 leading-snug">
              Enter a focus keyword above to check title, slug, description placement, and keyword density
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
