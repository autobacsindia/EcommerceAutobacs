/**
 * Training lists and the bell count must read about a page, not the collection.
 * Measured with explain() on 6,000 assignments across every team.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import { StaffTrainingPath as Path, StaffTrainingAssignment as Assignment, TRAINING_WAITING } from '../models/StaffTraining.js';

jest.setTimeout(120000);

const PAGE = 24;
const TEAMS = ['procurement', 'sales', 'marketing', 'accounts', 'support', 'warehouse'];
const id = () => new mongoose.Types.ObjectId();
const people = Array.from({ length: 300 }, id);
const stats = (e) => ({
  plan: JSON.stringify(e.queryPlanner.winningPlan),
  keys: e.executionStats.totalKeysExamined,
  docs: e.executionStats.totalDocsExamined,
});

beforeAll(async () => {
  await dbHandler.connect();
  await Assignment.syncIndexes();
  await Path.syncIndexes();
});
// The test database is wiped after every test, so each one seeds its own rows.
beforeEach(async () => {
  // Raw inserts: only the indexed fields matter to a query plan.
  await Assignment.collection.insertMany(Array.from({ length: 6000 }, (_, i) => {
    const waiting = i % 100 === 0;
    return {
      path: id(), user: people[i % 300], buddy: people[(i + 7) % 300], team: TEAMS[i % 6],
      status: waiting ? TRAINING_WAITING[0] : 'signed_off', ...(waiting ? { active: true } : {}),
    };
  }));
  await Path.collection.insertMany(Array.from({ length: 3000 }, (_, i) => ({ title: `P${i}`, team: TEAMS[i % 6], archivedAt: i % 10 === 0 ? new Date() : null })));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

test.each([
  ['my training', () => ({ user: people[3] })],
  ['my buddies', () => ({ buddy: people[3] })],
  ['one team', () => ({ team: 'sales' })],
  ['admin, everyone', () => ({})],
])('assignments: %s reads about one page', async (_name, filter) => {
  const s = stats(await Assignment.find(filter()).sort({ _id: -1 }).limit(PAGE).explain('executionStats'));
  console.log('assignments', _name, s.keys, s.docs);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.plan).not.toContain('"stage":"SORT"');
  expect(s.docs).toBeLessThanOrEqual(PAGE * 2);
  expect(s.keys).toBeLessThanOrEqual(PAGE * 3);
});

test.each([
  ['admin', {}],
  ['one team', { team: 'sales' }],
])('paths: %s reads about one page', async (_name, filter) => {
  const s = stats(await Path.find({ ...filter, archivedAt: null }).sort({ _id: -1 }).limit(PAGE).explain('executionStats'));
  console.log('paths', _name, s.keys, s.docs);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.plan).not.toContain('"stage":"SORT"');
  expect(s.docs).toBeLessThanOrEqual(PAGE * 2);
  expect(s.keys).toBeLessThanOrEqual(PAGE * 3);
});

test.each([
  ['admin', {}, 60],
  ['head', { team: 'marketing' }, 20],
])('bell count: %s touches only waiting rows', async (_name, filter, waiting) => {
  const q = { ...filter, active: true, status: { $in: TRAINING_WAITING } };
  expect(await Assignment.countDocuments(q)).toBe(waiting);
  const s = stats(await Assignment.find(q).select('_id').explain('executionStats'));
  console.log('bell', _name, s.keys, s.docs);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.docs).toBeLessThanOrEqual(waiting);
  expect(s.keys).toBeLessThanOrEqual(waiting + TRAINING_WAITING.length * 7);
});
