/**
 * utils/listQuery.js — the search / filter / sort pieces every staff list reads.
 * Pure functions: what a query string turns into.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import {
  afterClause, amountOf, amountRange, and, compareBySort, decodeCursor, encodeCursor, escapeRegex,
  findEachBranch, orPerBranch, istDayStart, istRange, plainQuery, searchClauses, searchWords, sortSpec,
} from '../utils/listQuery.js';

describe('searchWords', () => {
  it('lower-cases, trims and splits on spaces', () => {
    expect(searchWords('  Kochi   FUEL ')).toEqual(['kochi', 'fuel']);
  });
  it('is empty for nothing typed', () => {
    expect(searchWords('')).toEqual([]);
    expect(searchWords(undefined)).toEqual([]);
    expect(searchWords('   ')).toEqual([]);
  });
  it('keeps at most five words and sixty characters', () => {
    expect(searchWords('a b c d e f g')).toHaveLength(5);
    expect(searchWords('x'.repeat(200))[0]).toHaveLength(60);
  });
});

describe('amountOf', () => {
  it.each([['4500', 4500], ['4,500', 4500], ['₹4500', 4500], ['rs4500', 4500], ['4500.50', 4500.5]])('%s → %d', (w, n) => {
    expect(amountOf(w)).toBe(n);
  });
  it.each(['pr-0042', 'abc', '0', '1.234', '', '-5'])('%s is not an amount', (w) => {
    expect(amountOf(w)).toBeNull();
  });
});

describe('searchClauses', () => {
  it('one $or per word, every word required, special characters matched literally', () => {
    const [c1, c2] = searchClauses(['a.b', 'c'], ['x', 'y']);
    expect(c1.$or).toHaveLength(2);
    expect(c1.$or[0].x.test('a.b')).toBe(true);
    expect(c1.$or[0].x.test('axb')).toBe(false); // the dot is not a wildcard
    expect(c2.$or[1].y.source).toBe('c');
  });
  it('adds the extra clauses for a word', () => {
    const [c] = searchClauses(['4500'], ['x'], () => [{ amount: 4500 }]);
    expect(c.$or).toContainEqual({ amount: 4500 });
  });
  it('escapes every regex special character', () => {
    const nasty = '(.*+?^${}|[]\\)';
    expect(() => new RegExp(escapeRegex(nasty))).not.toThrow();
    expect(new RegExp(escapeRegex(nasty)).test(nasty)).toBe(true);
  });
});

describe('India-time days', () => {
  it('a day starts at 18:30 UTC the day before', () => {
    expect(istDayStart('2026-10-01').toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });
  it('refuses impossible and malformed dates', () => {
    expect(istDayStart('2026-02-31')).toBeNull();
    expect(istDayStart('2026-13-01')).toBeNull();
    expect(istDayStart('01-10-2026')).toBeNull();
    expect(istDayStart('')).toBeNull();
  });
  it('a range includes both days', () => {
    const r = istRange('2026-10-01', '2026-10-31');
    expect(r.$gte.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.$lt.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });
  it('either end may be open; neither → null', () => {
    expect(Object.keys(istRange('2026-10-01', ''))).toEqual(['$gte']);
    expect(Object.keys(istRange('', '2026-10-01'))).toEqual(['$lt']);
    expect(istRange('', '')).toBeNull();
    expect(istRange('junk', 'junk')).toBeNull();
  });
});

describe('amountRange', () => {
  it('reads either bound, inclusive', () => {
    expect(amountRange('100', '500')).toEqual({ $gte: 100, $lte: 500 });
    expect(amountRange('100', '')).toEqual({ $gte: 100 });
    expect(amountRange(undefined, '500')).toEqual({ $lte: 500 });
  });
  it('ignores junk and negatives', () => {
    expect(amountRange('abc', '-1')).toBeNull();
    expect(amountRange('', '')).toBeNull();
  });
});

describe('keyset cursors', () => {
  const byAmount = { field: 'amount', dir: -1, type: 'number' };
  const byDate = { field: 'payment.paidAt', dir: 1, type: 'date' };
  const id = new mongoose.Types.ObjectId();

  it('round-trips a number and a nested date', () => {
    expect(decodeCursor('a', byAmount, encodeCursor('a', byAmount, { _id: id, amount: 250 }))).toEqual({ value: 250, id });
    const at = new Date('2026-10-02T05:00:00Z');
    const back = decodeCursor('p', byDate, encodeCursor('p', byDate, { _id: id, payment: { paidAt: at } }));
    expect(back.value.getTime()).toBe(at.getTime());
  });
  it('a cursor from another sort, or junk, is ignored', () => {
    const c = encodeCursor('amount_desc', byAmount, { _id: id, amount: 250 });
    expect(decodeCursor('amount_asc', byAmount, c)).toBeNull();
    expect(decodeCursor('a', byAmount, 'not-a-cursor')).toBeNull();
    expect(decodeCursor('a', byAmount, '')).toBeNull();
    expect(decodeCursor('a', byAmount, Buffer.from('["a",1,"zzz"]').toString('base64url'))).toBeNull();
  });
  it('afterClause and sortSpec follow the direction', () => {
    // amount < 5, or amount 5 with a smaller id — as a range plus a $nor (an $or
    // here is split into index scans and sorted in memory by MongoDB 7.0).
    expect(afterClause(byAmount, { value: 5, id })).toEqual({ amount: { $lte: 5 }, $nor: [{ amount: 5, _id: { $gte: id } }] });
    const at = new Date('2026-10-02T05:00:00Z');
    expect(afterClause(byDate, { value: at, id })).toEqual({ 'payment.paidAt': { $gte: at }, $nor: [{ 'payment.paidAt': at, _id: { $lte: id } }] });
    expect(afterClause(byDate, null)).toBeNull();
    expect(sortSpec(byDate)).toEqual({ 'payment.paidAt': 1, _id: 1 });
  });
  it('a text sort round-trips; a unique field needs no _id tie-breaker', () => {
    const byName = { field: 'nameKey', dir: 1, type: 'string', unique: true };
    expect(decodeCursor('n', byName, encodeCursor('n', byName, { _id: id, nameKey: 'bosch' }))).toEqual({ value: 'bosch', id });
    expect(decodeCursor('n', byName, Buffer.from(JSON.stringify(['n', 5, String(id)])).toString('base64url'))).toBeNull();
    expect(sortSpec(byName)).toEqual({ nameKey: 1 });
    expect(afterClause(byName, { value: 'bosch', id })).toEqual({ nameKey: { $gt: 'bosch' } });
  });
  it('a sort on _id itself round-trips as an id; anything else in its place is ignored', () => {
    const byId = { field: '_id', dir: -1, type: 'objectId', unique: true };
    const back = decodeCursor('newest', byId, encodeCursor('newest', byId, { _id: id }));
    expect(back.value).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(String(back.value)).toBe(String(id));
    expect(afterClause(byId, back)).toEqual({ _id: { $lt: back.value } });
    expect(sortSpec(byId)).toEqual({ _id: -1 });
    expect(decodeCursor('newest', byId, Buffer.from(JSON.stringify(['newest', '2026-10-01', String(id)])).toString('base64url'))).toBeNull();
  });
});

describe('orPerBranch', () => {
  const query = { $or: [{ a: 1 }, { b: 1 }] };
  const after = { t: { $lte: 5 } };
  it('carries the cursor into each branch, keeping the $or at the top', () => {
    expect(orPerBranch(and(query, after), query)).toEqual({ $or: [{ $and: [{ a: 1 }, after] }, { $and: [{ b: 1 }, after] }] });
  });
  it('page 1, or a query that is not an $or, is left alone', () => {
    expect(orPerBranch(query, query)).toBe(query);
    const plain = { a: 1 };
    const q = and(plain, after);
    expect(orPerBranch(q, plain)).toBe(q);
  });
});

describe('findEachBranch', () => {
  const ids = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId());
  const at = (h) => new Date(Date.UTC(2026, 9, 1, h));
  const row = (i, h) => ({ _id: ids[i], createdAt: at(h) });
  const sort = { createdAt: -1, _id: -1 };
  const query = { $or: [{ a: 1 }, { b: 1 }] };

  it('one find per branch, merged newest first; a row in both branches once; cut to the limit', async () => {
    const seen = [];
    const find = async (q, opts) => {
      seen.push([q, opts]);
      return q.a ? [row(0, 9), row(2, 5), row(3, 5)] : [row(1, 7), row(2, 5), row(4, 1)];
    };
    const rows = await findEachBranch(query, query, { sort, limit: 4 }, find);
    // ids[2] and ids[3] share an hour: the larger id comes first (newest first).
    const tied = [ids[2], ids[3]].sort((x, y) => (String(x) < String(y) ? 1 : -1));
    expect(rows.map((r) => r._id)).toEqual([ids[0], ids[1], ...tied]);
    // Each find is told which branch it reads (the list picks that branch's index by it).
    expect(seen).toEqual([[{ a: 1 }, { sort, limit: 4, branch: 0 }], [{ b: 1 }, { sort, limit: 4, branch: 1 }]]);
  });

  it('page 2 carries the cursor into each branch', async () => {
    const cursor = { createdAt: { $lte: at(5) } };
    const seen = [];
    await findEachBranch(and(query, cursor), query, { sort, limit: 2 }, async (q) => { seen.push(q); return []; });
    expect(seen).toEqual([{ $and: [{ a: 1 }, cursor] }, { $and: [{ b: 1 }, cursor] }]);
  });

  it('a query that is not an $or is one find, as asked', async () => {
    const q = { a: 1 };
    const find = jest.fn(async () => [row(0, 1)]);
    expect(await findEachBranch(q, q, { sort, limit: 2 }, find)).toEqual([row(0, 1)]);
    expect(find).toHaveBeenCalledWith(q, { sort, limit: 2, branch: 0 });
  });

  it('compareBySort: oldest first, numbers, and a missing value sorts lowest', () => {
    const asc = compareBySort({ amount: 1, _id: 1 });
    const rows = [{ _id: ids[1], amount: 5 }, { _id: ids[0] }, { _id: ids[2], amount: 2 }];
    expect(rows.sort(asc).map((r) => r.amount)).toEqual([undefined, 2, 5]);
  });
});

describe('and / plainQuery', () => {
  it('drops empty clauses', () => {
    expect(and({}, null, [])).toEqual({});
    expect(and({ a: 1 }, null)).toEqual({ a: 1 });
    expect(and({ a: 1 }, [{ b: 2 }])).toEqual({ $and: [{ a: 1 }, { b: 2 }] });
  });
  it('first value of a repeated key; objects (operator injection) dropped', () => {
    expect(plainQuery({ q: ['a', 'b'], sort: 'oldest', by: { $ne: 'x' } })).toEqual({ q: 'a', sort: 'oldest' });
  });
});
