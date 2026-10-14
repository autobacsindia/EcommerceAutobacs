import { jest } from '@jest/globals';

/**
 * The sort whitelist is the only thing standing between a query parameter and
 * Mongoose's .sort(), so it is worth asserting directly rather than through a
 * route.
 */
const { SORT_OPTIONS } = await import('../../../controllers/leadController.js');

describe('lead list sort options', () => {
  it('offers "recently active", sorted on last activity', () => {
    /*
      `createdAt` answers "who is new". It does not answer "who just acted
      again": a lead created in August who abandons checkout again today gets a
      new source appended, which bumps `updatedAt` and leaves `createdAt` alone.
      Under newest-first they stay buried while being one of the hottest people
      on the list.
    */
    expect(SORT_OPTIONS.updated).toEqual({ updatedAt: -1 });
  });

  it('keeps the existing orders intact', () => {
    expect(SORT_OPTIONS.score).toEqual({ leadScore: -1, createdAt: -1 });
    expect(SORT_OPTIONS.newest).toEqual({ createdAt: -1 });
    expect(SORT_OPTIONS.oldest).toEqual({ createdAt: 1 });
  });

  it('exposes nothing that is not a deliberate sort', () => {
    // Guards the injection check in the controller: an attacker passing
    // `sort=constructor` must not resolve to anything.
    expect(Object.keys(SORT_OPTIONS).sort()).toEqual(
      ['follow_up', 'newest', 'oldest', 'recent_contact', 'score', 'updated'],
    );
    expect(Object.hasOwn(SORT_OPTIONS, 'constructor')).toBe(false);
  });
});
