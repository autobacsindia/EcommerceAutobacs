/**
 * The Handover list, "mine" and the bell (read on every poll) must not scan the
 * collection. Measured with explain() on 3,000 records across every team.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import StaffDeparture from '../models/StaffDeparture.js';

jest.setTimeout(120000);

const PAGE = 25;
const TEAMS = ['procurement', 'sales', 'marketing', 'accounts', 'support', 'warehouse'];
const people = Array.from({ length: 3000 }, () => new mongoose.Types.ObjectId());
const stats = (e) => ({
  plan: JSON.stringify(e.queryPlanner.winningPlan),
  keys: e.executionStats.totalKeysExamined,
  docs: e.executionStats.totalDocsExamined,
});

beforeAll(async () => { await dbHandler.connect(); await StaffDeparture.syncIndexes(); });
// The test database is wiped after every test, so each one seeds its own rows.
beforeEach(async () => {
  await StaffDeparture.collection.insertMany(people.map((user, i) => {
    const open = i % 50 === 0;
    return {
      user, successor: people[(i + 1) % 3000], team: TEAMS[i % 6], wasHead: i % 40 === 1, lastDay: open && i % 100 === 0 ? '2026-11-10' : '2026-12-30',
      status: open ? 'open' : 'left', ...(open ? { active: true } : {}),
    };
  }));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

test.each([
  ['admin', {}],
  ['head', { team: 'marketing', wasHead: false }],
])('list: %s reads about one page', async (_n, filter) => {
  const s = stats(await StaffDeparture.find(filter).sort({ _id: -1 }).limit(PAGE).explain('executionStats'));
  console.log('list', _n, s.keys, s.docs);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.plan).not.toContain('"stage":"SORT"');
  expect(s.docs).toBeLessThanOrEqual(PAGE * 2);
});

test('mine: only this person\'s open rows', async () => {
  const s = stats(await StaffDeparture.find({ active: true, $or: [{ user: people[50] }, { successor: people[49] }] }).limit(20).explain('executionStats'));
  console.log('mine', s.keys, s.docs);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.docs).toBeLessThanOrEqual(5);
});

test.each([
  ['admin', {}, 30],
  ['head', { team: 'procurement', wasHead: false }, 30],
])('bell: %s reads only what is due', async (_n, filter, due) => {
  const s = stats(await StaffDeparture.find({ ...filter, active: true, lastDay: { $lte: '2026-11-12' } }).select('user').limit(200).explain('executionStats'));
  console.log('bell', _n, s.keys, s.docs);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.docs).toBeLessThanOrEqual(due);
});
