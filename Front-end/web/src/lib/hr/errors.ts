/**
 * One reading of an HR API failure, so every screen shows the same friendly
 * words for the same situation.
 *
 * 404 means two different things on /api/v1/hr and the panel must tell them apart:
 *   - "Route not found": the endpoint isn't deployed yet (attendance / leave /
 *     payroll are built in parallel) → a calm "coming soon", never a crash.
 *   - anything else: the record doesn't exist OR this person may not see it —
 *     the server answers both the same way on purpose (ADR §1), so we do too.
 */
import { ApiError } from '@/lib/api-types';

export type HrErrorKind = 'signin' | 'forbidden' | 'notFound' | 'comingSoon' | 'conflict' | 'invalid' | 'other';

export type HrErrorView = { kind: HrErrorKind; title: string; message: string };

const ROUTE_MISSING = /route not found/i;

const statusOf = (err: unknown): number | undefined => {
  if (err instanceof ApiError) return err.status;
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
};

const messageOf = (err: unknown): string => {
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m.trim() : '';
};

export function describeHrError(err: unknown): HrErrorView {
  const status = statusOf(err);
  const message = messageOf(err);
  if (status === 401) {
    return { kind: 'signin', title: 'Please sign in again', message: 'Your session has ended. Sign in and open this page again.' };
  }
  if (status === 403) {
    return { kind: 'forbidden', title: 'Not available to you', message: 'This part of the HR panel is only for HR and admin. Ask HR if you think you should have access.' };
  }
  if (status === 404 && ROUTE_MISSING.test(message)) {
    return { kind: 'comingSoon', title: 'Coming soon', message: 'This part of the HR system is still being built. It will appear here once it is switched on.' };
  }
  if (status === 404) {
    return { kind: 'notFound', title: 'Not found', message: 'We could not find this record. It may have been removed, or it is not one you can see.' };
  }
  if (status === 409) {
    return { kind: 'conflict', title: 'Changed by someone else', message: message || 'Someone changed this since you opened it. Reload and try again.' };
  }
  if (status === 400 || status === 422) {
    return { kind: 'invalid', title: 'Please check', message: message || 'Some details are not right.' };
  }
  return { kind: 'other', title: 'Something went wrong', message: 'We could not load this. Check your connection and try again.' };
}

/** True when the endpoint simply isn't deployed yet. */
export const isComingSoon = (err: unknown): boolean => describeHrError(err).kind === 'comingSoon';
