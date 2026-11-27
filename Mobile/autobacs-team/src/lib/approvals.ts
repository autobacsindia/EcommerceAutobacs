/**
 * Approvals helpers (pure — tests/approvals.test.ts). The server decides who
 * may approve and whether a decision stands; these only shape the screen.
 */
import type { AppCapabilities, Decision } from '../api/types';

export type Section = 'leave' | 'fixDay' | 'overtime';

export const SECTION_LABEL: Record<Section, string> = { leave: 'Leave', fixDay: 'Fix day', overtime: 'Overtime' };

/** Sections this login may see, in a fixed order. */
export function visibleSections(c: AppCapabilities): Section[] {
  return (['leave', 'fixDay', 'overtime'] as const).filter((s) => c.canApprove[s]);
}

/** A rejection must say why (the leave API refuses < 3 characters). */
export function decisionError(decision: Decision, note: string): string | null {
  if (decision === 'rejected' && note.trim().length < 3) return 'Write a short reason for the person.';
  return null;
}

export const OT_STEP = 15;

/** Approved overtime in 15-minute steps, never above what was worked. */
export function clampOtMinutes(minutes: number, max: number): number {
  const stepped = Math.round(minutes / OT_STEP) * OT_STEP;
  return Math.max(0, Math.min(max, stepped));
}

export const NO_CAPS: AppCapabilities = { canApprove: { leave: false, fixDay: false, overtime: false }, isHr: false, isHead: false };

export function canApproveAnything(c: AppCapabilities | undefined): boolean {
  return !!c && (c.canApprove.leave || c.canApprove.fixDay || c.canApprove.overtime);
}
