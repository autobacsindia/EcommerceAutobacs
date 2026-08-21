/**
 * Unit tests for the drift-audit comparison logic.
 *
 * These are pure-function tests; importing the script does NOT connect to a
 * database (main() is guarded behind a direct-invocation check, precisely so
 * this file cannot run an audit against production as an import side effect).
 */

import { keySignature, behaviouralOptions } from '../../../scripts/audit-index-drift.js';

describe('keySignature', () => {
  it('collapses the two text-index shapes onto one signature', () => {
    // A schema declares the fields; MongoDB reports { _fts, _ftsx } + weights.
    const schemaSide = keySignature({ name: 'text', tags: 'text' });
    const dbSide = keySignature({ _fts: 'text', _ftsx: 1 }, { name: 1, tags: 1 });
    expect(dbSide).toBe(schemaSide);
  });

  it('is order-independent for text fields', () => {
    expect(keySignature({ tags: 'text', name: 'text' }))
      .toBe(keySignature({ name: 'text', tags: 'text' }));
  });

  it('distinguishes ordinary compound indexes by field order', () => {
    expect(keySignature({ a: 1, b: -1 })).not.toBe(keySignature({ b: -1, a: 1 }));
  });
});

describe('behaviouralOptions — text weights', () => {
  // THE BUG: MongoDB always REPORTS a weights map (every field at 1) while a
  // schema that never called `weights` carries none. Comparing `{}` against
  // `{ subject: 1, ... }` never matched, so supporttickets' text index was
  // permanently MISMATCHED and every `--apply` dropped and recreated a live index.
  it('treats an all-1s weights map as the default and ignores it', () => {
    const fromDb = behaviouralOptions({ weights: { subject: 1, 'requester.name': 1 } });
    const fromSchema = behaviouralOptions({});
    expect(fromDb).toEqual(fromSchema);
    expect(fromDb.weights).toBeUndefined();
  });

  it('KEEPS genuinely non-default weights — those change behaviour', () => {
    expect(behaviouralOptions({ weights: { name: 10, tags: 1 } }).weights)
      .toEqual({ name: 10, tags: 1 });
  });

  it('still reports drift when only one side has custom weights', () => {
    const schema = behaviouralOptions({ weights: { name: 10 } });
    const db = behaviouralOptions({ weights: { name: 1 } });
    expect(JSON.stringify(schema)).not.toBe(JSON.stringify(db));
  });

  it('sorts weight keys so key order alone is never drift', () => {
    expect(JSON.stringify(behaviouralOptions({ weights: { b: 5, a: 2 } })))
      .toBe(JSON.stringify(behaviouralOptions({ weights: { a: 2, b: 5 } })));
  });
});

describe('behaviouralOptions — other fields', () => {
  it('carries the options that actually change behaviour', () => {
    const opts = behaviouralOptions({
      unique: true,
      sparse: true,
      expireAfterSeconds: 60,
      partialFilterExpression: { a: { $type: 'string' } },
    });
    expect(opts).toEqual({
      unique: true,
      sparse: true,
      expireAfterSeconds: 60,
      partialFilterExpression: { a: { $type: 'string' } },
    });
  });

  it('ignores cosmetic fields that differ on every index', () => {
    expect(behaviouralOptions({ background: true, v: 2, ns: 'db.c', name: 'a_1' }))
      .toEqual({});
  });

  // expireAfterSeconds: 0 is a REAL TTL (expire at the stored date), not absent.
  it('does not lose a zero-second TTL', () => {
    expect(behaviouralOptions({ expireAfterSeconds: 0 }).expireAfterSeconds).toBe(0);
  });
});
