/**
 * leadScore — a single 0–100 hotness/priority number for a Lead, so the sales
 * worklist can rank the strong prospects above the flood of low-intent signals
 * (abandoned carts, never-purchased signups) instead of sorting purely by time.
 *
 * Pure + synchronous by design: it reads ONLY fields already on the Lead document
 * (status, primarySource, sources[].snapshot, reopenCount, hasPurchased). No DB
 * lookups, so leadSyncService can recompute it inline on every write with zero
 * extra queries. The number is denormalised onto `Lead.leadScore` and indexed for
 * server-side sorting; the daily sweep refreshes it so the recency term decays.
 *
 * Composition (max contributions, summed then clamped to 0–100):
 *   • Intent   0–45  — strongest source's SOURCE_INTENT_SCORE (payment > cart > dormant)
 *   • Monetary 0–20  — biggest cart/order value the prospect actually reached
 *   • Recency  0–15  — freshest signal, linear decay over the window
 *   • Engagement 0–20 — reopened cycle (+8), ≥2 distinct signals (+4), existing customer (+8)
 *
 * Terminal leads (won/lost) score 0 so a closed decision never floats to the top
 * of an active queue; a fresh signal reopens the cycle (status→new) and the next
 * recompute restores a real score.
 */

import {
  SOURCE_INTENT_SCORE,
  SOURCE_PRIORITY,
  TERMINAL_LEAD_STATUSES,
} from '../config/leadConstants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Recency decays linearly to 0 over this window; env-overridable for tuning
// without a deploy. Kept aligned with the dormancy/follow-up sweep horizon.
const RECENCY_WINDOW_DAYS = Number(process.env.LEAD_SCORE_RECENCY_WINDOW_DAYS) || 30;
const RECENCY_MAX = 15;

// Monetary bands in paise (₹). A prospect who reached a ₹50k cart is worth chasing
// harder than a ₹500 one. Ordered high→low; first match wins.
const MONETARY_BANDS = [
  [50_00_000, 20], // ≥ ₹50,000
  [20_00_000, 15], // ≥ ₹20,000
  [10_00_000, 11], // ≥ ₹10,000
  [5_00_000, 7],   // ≥ ₹5,000
  [1_00_000, 4],   // ≥ ₹1,000
  [1, 2],          // any non-zero value
];

function monetaryBand(paise) {
  for (const [floor, points] of MONETARY_BANDS) {
    if (paise >= floor) return points;
  }
  return 0;
}

function highestPrioritySourceType(sources) {
  return sources.reduce(
    (best, s) => (SOURCE_PRIORITY[s.type] > (SOURCE_PRIORITY[best] || 0) ? s.type : best),
    sources[0]?.type
  );
}

/**
 * Compute the 0–100 score for a lead document (or a plain object with the same
 * shape). Safe on partial/malformed input — never throws.
 * @param {object} lead
 * @returns {number} integer 0–100
 */
export function computeLeadScore(lead) {
  if (!lead) return 0;
  if (TERMINAL_LEAD_STATUSES.includes(lead.status)) return 0;

  const sources = Array.isArray(lead.sources) ? lead.sources : [];
  if (sources.length === 0) return 0;

  // Intent — the strongest signal drives the base contribution.
  const primary = lead.primarySource || highestPrioritySourceType(sources);
  const intent = SOURCE_INTENT_SCORE[primary] || 0;

  // Monetary — the biggest cart/order value seen across the person's signals.
  const maxTotal = sources.reduce(
    (m, s) => Math.max(m, Number(s?.snapshot?.total) || 0),
    0
  );
  const monetary = monetaryBand(maxTotal);

  // Recency — freshest capturedAt, linear decay over the window.
  const freshest = sources.reduce((t, s) => {
    const at = s?.capturedAt ? new Date(s.capturedAt).getTime() : 0;
    return at > t ? at : t;
  }, 0);
  const ageDays = freshest ? (Date.now() - freshest) / DAY_MS : RECENCY_WINDOW_DAYS;
  const recency = Math.max(
    0,
    RECENCY_MAX * (1 - Math.min(Math.max(ageDays, 0), RECENCY_WINDOW_DAYS) / RECENCY_WINDOW_DAYS)
  );

  // Engagement — repeat interest and existing-customer value.
  let engagement = 0;
  if ((lead.reopenCount || 0) > 0) engagement += 8;
  if (new Set(sources.map((s) => s.type)).size >= 2) engagement += 4;
  if (lead.hasPurchased) engagement += 8;

  const score = intent + monetary + recency + engagement;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Presentation buckets for the score (kept backend-side so any future email/SLA
// automation shares the same thresholds the UI shows).
export const SCORE_HOT = 60;
export const SCORE_WARM = 30;

export function scoreTier(score) {
  if (score >= SCORE_HOT) return 'hot';
  if (score >= SCORE_WARM) return 'warm';
  return 'cold';
}

export default { computeLeadScore, scoreTier, SCORE_HOT, SCORE_WARM };
