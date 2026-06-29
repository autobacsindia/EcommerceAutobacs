// Resolves an analytics time window from query params into concrete date ranges.
//
// Accepts either a named `period` (7d|30d|90d|12m) or an explicit `from`/`to` pair.
// Always returns the current window, the immediately-preceding window of equal length
// (for period-over-period deltas), and a sensible bucket granularity for trend charts.
//
// Ranges are clamped to MAX_RANGE_DAYS to bound aggregation scans — admin analytics is
// cached and low-QPS, but we never want an unbounded full-collection scan from a hand-typed
// `from=1970-01-01`.

const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_RANGE_DAYS = 400; // ~13 months — the documented cap

const NAMED_PERIODS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

export const DEFAULT_PERIOD = '30d';

/**
 * Pick a bucket granularity from the window length so trend charts stay readable.
 * @param {number} days
 * @returns {'day'|'week'|'month'}
 */
export function granularityForDays(days) {
  if (days <= 92) return 'day';
  if (days <= 184) return 'week';
  return 'month';
}

/**
 * Resolve a window from query params.
 * @param {{ period?: string, from?: string, to?: string }} query
 * @returns {{ from: Date, to: Date, prevFrom: Date, prevTo: Date, days: number,
 *            granularity: 'day'|'week'|'month', label: string }}
 */
export function resolvePeriod(query = {}) {
  const { period, from, to } = query;

  let end;
  let start;
  let label;

  if (from) {
    // Explicit range. `to` defaults to now.
    start = new Date(from);
    end = to ? new Date(to) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      // Fall back to default rather than throwing — validator already screens obvious garbage.
      return resolvePeriod({ period: DEFAULT_PERIOD });
    }
    if (start > end) [start, end] = [end, start];
    label = 'custom';
  } else {
    const key = NAMED_PERIODS[period] ? period : DEFAULT_PERIOD;
    const days = NAMED_PERIODS[key];
    end = new Date();
    start = new Date(end.getTime() - days * DAY_MS);
    label = key;
  }

  // Clamp the span to the documented maximum.
  let spanMs = end.getTime() - start.getTime();
  if (spanMs > MAX_RANGE_DAYS * DAY_MS) {
    start = new Date(end.getTime() - MAX_RANGE_DAYS * DAY_MS);
    spanMs = end.getTime() - start.getTime();
  }
  // Guard against a zero-length window (e.g. from === to).
  if (spanMs <= 0) {
    spanMs = DAY_MS;
    start = new Date(end.getTime() - spanMs);
  }

  const days = Math.max(1, Math.round(spanMs / DAY_MS));

  // Previous window of equal length, immediately preceding the current one.
  const prevTo = new Date(start.getTime());
  const prevFrom = new Date(start.getTime() - spanMs);

  return {
    from: start,
    to: end,
    prevFrom,
    prevTo,
    days,
    granularity: granularityForDays(days),
    label,
  };
}
