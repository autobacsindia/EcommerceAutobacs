/**
 * Where a notification tap may take the app. The server sends a `path` in the
 * notification data; only these screens are allowed, so a crafted payload can
 * never deep-link somewhere unexpected. Pure — tested in tests/push.test.ts.
 */
export const PUSH_PATHS = ['/', '/history', '/leave', '/payslips', '/marks', '/approvals', '/holidays', '/documents'] as const;
export type PushPath = (typeof PUSH_PATHS)[number];

export function pushTarget(data: unknown): PushPath | null {
  const path = (data as { path?: unknown } | null | undefined)?.path;
  return typeof path === 'string' && (PUSH_PATHS as readonly string[]).includes(path) ? (path as PushPath) : null;
}
