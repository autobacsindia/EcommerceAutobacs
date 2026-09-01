/**
 * "Did you mean" scoring.
 *
 * Atlas Search has no spell suggester, so a correction has to be mined from what
 * the index actually contains. The mining is one loose fuzzy probe; the JUDGEMENT
 * — is this candidate close enough to show a shopper — lives in these pure
 * functions, so it is testable without a cluster.
 */

import { editDistance, pickCorrection } from '../../../utils/searchHelpers.js';

describe('editDistance — Damerau, not plain Levenshtein', () => {
  it('scores an adjacent transposition as ONE edit', () => {
    // The load-bearing case. Transposition is the most common human typo, and
    // plain Levenshtein scores it 2 — which puts it outside the one-edit budget a
    // 5-7 character word gets, so corrections would fail on exactly the mistakes
    // the feature exists to catch.
    expect(editDistance('brkae', 'brake')).toBe(1);
    expect(editDistance('wnich', 'winch')).toBe(1);
  });

  it('scores substitution, insertion and deletion as one edit each', () => {
    expect(editDistance('brake', 'brakes')).toBe(1);
    expect(editDistance('brakes', 'brake')).toBe(1);
    expect(editDistance('brake', 'brakr')).toBe(1);
  });

  it('returns 0 for an exact match', () => {
    expect(editDistance('winch', 'winch')).toBe(0);
  });

  it('bails out past the budget instead of computing an exact distance', () => {
    // The caller only ever asks "close enough?", so anything past max is equally
    // useless — max + 1 is the sentinel for "further than you care about".
    expect(editDistance('abcdefgh', 'zzzzzzzz', 2)).toBe(3);
    expect(editDistance('short', 'aaaaaaaaaaaaaaaa', 2)).toBe(3);
  });
});

describe('pickCorrection', () => {
  const CATALOGUE = ['Brake Pads Front', 'Winch Mount Plate', 'Suspension Kit', 'Roof Rack'];

  it('corrects a transposed word inside a phrase', () => {
    expect(pickCorrection('brkae pads', CATALOGUE))
      .toEqual({ original: 'brkae', suggested: 'brake', distance: 1 });
  });

  it('allows two edits for a long word but only one for a short one', () => {
    // Length-scaled budget: a long word can absorb more damage before the
    // suggestion stops being credible.
    expect(pickCorrection('suspenshion', CATALOGUE)?.suggested).toBe('suspension');
    // 'wxnch' is one edit from 'winch' — accepted.
    expect(pickCorrection('wxnch', CATALOGUE)?.suggested).toBe('winch');
    // 'wxnzh' is two edits from a 5-letter word — rejected.
    expect(pickCorrection('wxnzh', CATALOGUE)).toBeNull();
  });

  it('never "corrects" a word that already exists in the catalogue', () => {
    // Suggesting an alternative for a query that was spelled correctly reads as a
    // broken search.
    expect(pickCorrection('brake pads', CATALOGUE)).toBeNull();
    expect(pickCorrection('winch', CATALOGUE)).toBeNull();
  });

  it('ignores tokens shorter than four characters', () => {
    // Almost every 2-3 letter string is one edit from another, so correcting them
    // produces confident nonsense: "led" would become "bed".
    expect(pickCorrection('led', ['Bed Liner'])).toBeNull();
    expect(pickCorrection('kit', ['Kit'])).toBeNull();
  });

  it('returns null when nothing is close enough', () => {
    expect(pickCorrection('zzzzqqqq', CATALOGUE)).toBeNull();
  });

  it('survives empty, blank and absent input', () => {
    expect(pickCorrection('', CATALOGUE)).toBeNull();
    expect(pickCorrection('   ', CATALOGUE)).toBeNull();
    expect(pickCorrection('brkae', [])).toBeNull();
    expect(pickCorrection('brkae', null)).toBeNull();
    expect(pickCorrection(null, CATALOGUE)).toBeNull();
  });

  it('prefers the closest candidate when several are in range', () => {
    const result = pickCorrection('brakr', ['Brake Pads', 'Brakes Rear', 'Brack Mount']);
    expect(result.distance).toBe(1);
    expect(result.suggested).toBe('brake');
  });
});
