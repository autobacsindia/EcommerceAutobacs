/**
 * Unit tests for OrderStatusService
 *
 * Pure logic — no DB, no mocks, no I/O.
 * Tests the STATUS_TRANSITIONS table, admin-only gating, and
 * the getValidNextStatuses() helper exhaustively.
 */

import {
  OrderStatusService,
  STATUS_TRANSITIONS,
  ADMIN_ONLY_TRANSITIONS,
} from '../services/orderStatusService.js';

const svc = new OrderStatusService();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** All statuses defined in the transition table */
const ALL_STATUSES = Object.keys(STATUS_TRANSITIONS);

/** Statuses that have no allowed next states */
const TERMINAL_STATUSES = ALL_STATUSES.filter(
  (s) => STATUS_TRANSITIONS[s].length === 0
);

// ── 1. Valid transitions ──────────────────────────────────────────────────────

describe('validateTransition — valid moves (non-admin)', () => {
  for (const [from, targets] of Object.entries(STATUS_TRANSITIONS)) {
    for (const to of targets) {
      // Skip admin-only transitions when testing as non-admin
      const isAdminOnly =
        ADMIN_ONLY_TRANSITIONS[from] &&
        ADMIN_ONLY_TRANSITIONS[from].includes(to);
      if (isAdminOnly) continue;

      test(`${from} → ${to} is valid for customer`, () => {
        const result = svc.validateTransition(from, to, false);
        expect(result.valid).toBe(true);
      });
    }
  }
});

describe('validateTransition — valid moves (admin)', () => {
  for (const [from, targets] of Object.entries(STATUS_TRANSITIONS)) {
    for (const to of targets) {
      test(`${from} → ${to} is valid for admin`, () => {
        const result = svc.validateTransition(from, to, true);
        expect(result.valid).toBe(true);
      });
    }
  }
});

// ── 2. Invalid transitions ────────────────────────────────────────────────────

describe('validateTransition — invalid moves', () => {
  test('pending → shipped (skips confirmed/processing) returns invalid', () => {
    const result = svc.validateTransition('pending', 'shipped', false);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/Cannot transition/i);
  });

  test('delivered → processing (backwards) returns invalid', () => {
    const result = svc.validateTransition('delivered', 'processing', false);
    expect(result.valid).toBe(false);
  });

  test('confirmed → refunded (non-adjacent skip) returns invalid', () => {
    const result = svc.validateTransition('confirmed', 'refunded', false);
    expect(result.valid).toBe(false);
  });

  test('pending → pending (self-loop) returns invalid', () => {
    const result = svc.validateTransition('pending', 'pending', false);
    expect(result.valid).toBe(false);
  });

  test('unknown current status returns invalid with descriptive message', () => {
    const result = svc.validateTransition('nonexistent_status', 'confirmed', false);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/Invalid current status/i);
  });

  test('valid current status → unknown new status returns invalid', () => {
    const result = svc.validateTransition('pending', 'unknown_target', false);
    expect(result.valid).toBe(false);
  });
});

// ── 3. Terminal states ────────────────────────────────────────────────────────

describe('validateTransition — terminal states allow no transitions', () => {
  test.each(TERMINAL_STATUSES)(
    '%s → any status is invalid for customers',
    (terminal) => {
      // Customers cannot leave terminal states (no entries in STATUS_TRANSITIONS).
      // Admin bypass is intentional — the service allows admins to force
      // any transition (manual correction capability).
      for (const target of ALL_STATUSES) {
        const result = svc.validateTransition(terminal, target, false);
        expect(result.valid).toBe(false);
      }
    }
  );

  test.each(TERMINAL_STATUSES)(
    '%s → returns empty list from getValidNextStatuses (even for admin)',
    (terminal) => {
      // The STATUS_TRANSITIONS table has [] for terminal states.
      // getValidNextStatuses reflects this regardless of role.
      expect(svc.getValidNextStatuses(terminal, false)).toEqual([]);
      expect(svc.getValidNextStatuses(terminal, true)).toEqual([]);
    }
  );
});

// ── 4. Admin-only transitions ─────────────────────────────────────────────────

describe('validateTransition — admin-only gating', () => {
  test('customer cannot cancel a processing order', () => {
    // processing → cancelled is admin-only
    const result = svc.validateTransition('processing', 'cancelled', false);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/Admin permission required/i);
  });

  test('admin CAN cancel a processing order', () => {
    const result = svc.validateTransition('processing', 'cancelled', true);
    expect(result.valid).toBe(true);
  });

  test('customer cannot initiate refund from delivered', () => {
    // delivered → refunded is admin-only
    const result = svc.validateTransition('delivered', 'refunded', false);
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/Admin permission required/i);
  });

  test('admin CAN initiate refund from delivered', () => {
    const result = svc.validateTransition('delivered', 'refunded', true);
    expect(result.valid).toBe(true);
  });
});

// ── 5. getValidNextStatuses ───────────────────────────────────────────────────

describe('getValidNextStatuses', () => {
  test('pending — customer sees confirmed, cancelled, failed', () => {
    const statuses = svc.getValidNextStatuses('pending', false);
    expect(statuses).toEqual(expect.arrayContaining(['confirmed', 'cancelled', 'failed']));
  });

  test('processing — customer does NOT see cancelled (admin-only)', () => {
    const statuses = svc.getValidNextStatuses('processing', false);
    expect(statuses).not.toContain('cancelled');
  });

  test('processing — admin sees cancelled', () => {
    const statuses = svc.getValidNextStatuses('processing', true);
    expect(statuses).toContain('cancelled');
  });

  test('delivered — customer does NOT see refunded (admin-only)', () => {
    const statuses = svc.getValidNextStatuses('delivered', false);
    expect(statuses).not.toContain('refunded');
  });

  test('delivered — admin sees refunded', () => {
    const statuses = svc.getValidNextStatuses('delivered', true);
    expect(statuses).toContain('refunded');
  });

  test('unknown status — returns empty array gracefully', () => {
    expect(svc.getValidNextStatuses('ghost_status', false)).toEqual([]);
  });
});
