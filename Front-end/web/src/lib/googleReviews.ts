/**
 * Google review bonus — shared types and plain-word helpers for the salesperson
 * screen and the marketing head / admin queue. Every rule is enforced by the
 * server (services/googleReviewService.js); these only format and pre-check.
 */
export type ReviewStatus = 'pending' | 'verified' | 'rejected';
export type ReviewAction = 'submitted' | 'verified' | 'points_changed' | 'unverified' | 'rejected';

export interface ReviewHistoryEntry {
  action: ReviewAction;
  at: string;
  byName: string;
  stars: number | null;
  points: number | null;
  deltaPoints: number | null;
  month: string | null;
  reason: string;
}

export interface GoogleReview {
  id: string;
  status: ReviewStatus;
  submittedBy: { id: string; name: string };
  customerName: string;
  customerPhone: string;
  orderId: string | null;
  orderNumber: string;
  claimedStars: number | null;
  notes: string;
  stars: number | null;
  points: number;
  creditMonth: string | null;
  reason: string;
  reviewedByName: string;
  reviewedAt: string | null;
  createdAt: string;
  version: number;
  screenshotUrl: string;
  history: ReviewHistoryEntry[];
}

export interface ReviewPolicy {
  canSubmit: boolean;
  canReview: boolean;
  maxPoints: number;
  suggestedByStars: number[];
  maxScreenshotBytes: number;
}

export interface ReviewPage { reviews: GoogleReview[]; nextCursor: string | null; pendingCount?: number }
export type ReviewFilter = ReviewStatus | 'all';

export const STATUS_LABEL: Record<ReviewStatus, { text: string; cls: string }> = {
  pending: { text: 'Waiting for check', cls: 'bg-amber-50 text-amber-800' },
  verified: { text: 'Verified', cls: 'bg-green-50 text-green-700' },
  rejected: { text: 'Rejected', cls: 'bg-red-50 text-red-700' },
};

const ACTION_TEXT: Record<ReviewAction, string> = {
  submitted: 'Sent',
  verified: 'Verified',
  points_changed: 'Points changed',
  unverified: 'Unverified',
  rejected: 'Rejected',
};

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('en-IN')}`;

/** One history line in plain words, e.g. "Verified by Asha — 5★, +50 pts". */
export function describeHistory(h: ReviewHistoryEntry): string {
  const by = h.byName ? ` by ${h.byName}` : '';
  const bits: string[] = [];
  if (h.action === 'submitted' && h.stars) bits.push(`said ${h.stars}★`);
  if ((h.action === 'verified' || h.action === 'points_changed') && h.stars) bits.push(`${h.stars}★`);
  if (h.deltaPoints) bits.push(`${signed(h.deltaPoints)} pts`);
  if (h.action === 'points_changed' && h.points != null) bits.push(`now ${h.points} pts`);
  if (h.reason) bits.push(`“${h.reason}”`);
  return `${ACTION_TEXT[h.action]}${by}${bits.length ? ` — ${bits.join(', ')}` : ''}`;
}

/** Suggested points for a star count (the reviewer types the final number). */
export const suggestedPoints = (policy: Pick<ReviewPolicy, 'suggestedByStars'>, stars: number | null): number =>
  stars && stars >= 1 && stars <= 5 ? policy.suggestedByStars[stars - 1] ?? 0 : 0;

export const SCREENSHOT_ACCEPT = 'image/jpeg,image/png,image/webp';
const SCREENSHOT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/** A friendly pre-check before upload; the server checks the real bytes again. */
export function screenshotProblem(file: File | null, maxBytes: number): string {
  if (!file) return 'Attach a screenshot of the Google review.';
  if (!SCREENSHOT_TYPES.has(file.type)) return 'The screenshot must be a JPG, PNG or WebP image.';
  if (file.size > maxBytes) return `The screenshot is too large (${Math.round(maxBytes / (1024 * 1024))} MB maximum).`;
  return '';
}

/** Made once per form so a retried submit is recognised by the server. */
export function newSubmitId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export const fmtDateTime = (d: string | null) => (d
  ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
  : '—');

export const errorText = (e: unknown, fallback: string) =>
  (e as { rawData?: { message?: string } })?.rawData?.message || (e as Error)?.message || fallback;
