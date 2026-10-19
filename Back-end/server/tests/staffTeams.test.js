/**
 * The company's teams (config/staff.js) and what a team automatically gets.
 *
 * Nearly everything about a team is DERIVED from STAFF_TEAM_VALUES — the User
 * model's enum, the chat spaces, the team-to-team conversations, who may raise
 * an expense. That is the design, and it is what makes adding a team a
 * one-line change. These tests pin that wiring, so the day a team is added
 * nobody has to remember five other files.
 *
 * Written when the Developer team was added; the assertions are about the
 * wiring, not about that team in particular.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => ({ add: () => Promise.resolve({}) }),
  getOrderQueue: () => ({ add: () => Promise.resolve({}) }),
  enqueueNotification: () => {},
  closeQueues: () => Promise.resolve(),
}));

const staffConfig = await import('../config/staff.js');
const { STAFF_TEAMS, STAFF_TEAM_VALUES, STAFF_TEAM_LABELS, isStaffTeam } = staffConfig;
const { DEFAULT_SPACES, TEAM_PAIRS } = await import('../services/chatService.js');
const { EXPENSE_TEAMS } = await import('../services/paymentRequestService.js');
const { default: User } = await import('../models/User.js');

describe('the team list', () => {
  it('gives every team a label people can read', () => {
    for (const team of STAFF_TEAM_VALUES) {
      expect(typeof STAFF_TEAM_LABELS[team]).toBe('string');
      expect(STAFF_TEAM_LABELS[team].length).toBeGreaterThan(0);
    }
    // No label without a team behind it, either.
    expect(Object.keys(STAFF_TEAM_LABELS).sort()).toEqual([...STAFF_TEAM_VALUES].sort());
  });

  it('includes the Developer team', () => {
    expect(STAFF_TEAMS.DEVELOPER).toBe('developer');
    expect(isStaffTeam('developer')).toBe(true);
    expect(STAFF_TEAM_LABELS.developer).toBe('Developer');
  });

  /*
    The User model's `staff.team` enum is STAFF_TEAM_VALUES itself. If that ever
    became a hand-written list, a new team would be rejected at save time with a
    validation error — after the admin had filled in the whole form.
  */
  it('is what the User model validates a staff account against', () => {
    const enumValues = User.schema.path('staff.team').enumValues;
    expect([...enumValues].sort()).toEqual([...STAFF_TEAM_VALUES].sort());
  });
});

describe('what a team gets automatically', () => {
  it('its own chat space', () => {
    for (const team of STAFF_TEAM_VALUES) {
      expect(DEFAULT_SPACES.some((s) => s.key === `team:${team}` && s.audience === 'team')).toBe(true);
    }
  });

  /*
    One conversation per PAIR of teams, each listed once. n teams → n(n-1)/2
    pairs; counting it here catches a pair built twice (two channels, half the
    messages in each) or a team left out of the pairing.
  */
  it('a private conversation with every other team, exactly once', () => {
    const n = STAFF_TEAM_VALUES.length;
    expect(TEAM_PAIRS).toHaveLength((n * (n - 1)) / 2);

    const seen = new Set(TEAM_PAIRS.map((p) => p.join(':')));
    expect(seen.size).toBe(TEAM_PAIRS.length);

    for (const team of STAFF_TEAM_VALUES) {
      const partners = TEAM_PAIRS.filter((p) => p.includes(team)).length;
      expect(partners).toBe(n - 1);
    }
  });

  it('the right to raise an expense', () => {
    expect([...EXPENSE_TEAMS].sort()).toEqual([...STAFF_TEAM_VALUES].sort());
  });

  /*
    A space name is reserved so nobody can create a custom space that collides
    with a team's own — which would be two "#developer" channels, and messages
    landing in whichever one the reader happened to open.
  */
  it('a reserved space name', () => {
    const names = DEFAULT_SPACES.map((s) => s.name);
    for (const team of STAFF_TEAM_VALUES) expect(names).toContain(team);
  });
});
