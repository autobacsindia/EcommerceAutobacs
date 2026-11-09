/**
 * The lesson list must be one index range that stops after a page, not a scan of
 * the library. Measured with explain() on 3,000 lessons across every audience.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import StaffLesson, { LESSON_AUDIENCES } from '../models/StaffLesson.js';
import StaffLessonProgress from '../models/StaffLessonProgress.js';

jest.setTimeout(120000);

const PAGE = 25;
const stats = (e) => ({
  plan: JSON.stringify(e.queryPlanner.winningPlan),
  keys: e.executionStats.totalKeysExamined,
  docs: e.executionStats.totalDocsExamined,
});
const explainPage = (filter) => StaffLesson.find({ ...filter, archivedAt: null }).select('-body').sort({ _id: -1 }).limit(PAGE)
  .explain('executionStats');

beforeAll(async () => { await dbHandler.connect(); await StaffLesson.syncIndexes(); await StaffLessonProgress.syncIndexes(); });
beforeEach(async () => {
  const owner = new mongoose.Types.ObjectId();
  await StaffLesson.insertMany(Array.from({ length: 3000 }, (_, i) => ({
    title: `L${i}`, audience: LESSON_AUDIENCES[i % LESSON_AUDIENCES.length], owner, createdBy: owner, lastCheckedAt: new Date(),
    archivedAt: i % 10 === 0 ? new Date() : null,
  })));
});
afterAll(async () => { await dbHandler.closeDatabase(); });

test.each([
  ['admin, everything', {}],
  ['a member: company and their team', { audience: { $in: ['company', 'procurement'] } }],
  ['one section', { audience: 'procurement' }],
])('%s reads about one page', async (_name, filter) => {
  const s = stats(await explainPage(filter));
  console.log(_name, s.keys, s.docs);
  expect(s.plan).not.toContain('COLLSCAN');
  expect(s.plan).not.toContain('"stage":"SORT"');
  expect(s.docs).toBeLessThanOrEqual(PAGE * 2);
  expect(s.keys).toBeLessThanOrEqual(PAGE * 3);
});
